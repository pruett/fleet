import { describe, expect, it, afterEach } from "bun:test";
import { chmod, readFile } from "fs/promises";
import { join } from "path";
import { watchSession, stopWatching, stopAll, _registry } from "../watch-session";
import type { WatchBatch, WatchError, WatchHandle } from "../types";
import { createTempJsonl, appendLines, appendRaw, truncateFile, type TempJsonl } from "./helpers";
import { parseLine } from "../../parser";
import {
  makeUserPrompt,
  makeAssistantRecord,
  makeTextBlock,
  toLine,
} from "../../parser/__tests__/helpers";

describe("watchSession — tracer bullet", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("delivers parsed messages with correct byteRange after file append", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];
    let totalMessages = 0;
    let resolve: () => void;
    const allReceived = new Promise<void>((r) => {
      resolve = r;
    });

    handle = watchSession({
      sessionId: "test-tracer",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        totalMessages += batch.messages.length;
        if (totalMessages >= 2) resolve();
      },
      onError: () => {},
    });

    // File starts empty, so byteOffset should be 0
    expect(handle.byteOffset).toBe(0);
    expect(handle.lineIndex).toBe(0);

    // Append two JSONL lines in a single write
    const userLine = toLine(makeUserPrompt("Hello"));
    const assistantLine = toLine(
      makeAssistantRecord(makeTextBlock("Hi there")),
    );
    await appendLines(tmp.path, [userLine, assistantLine]);

    // Wait for callback with timeout
    await Promise.race([
      allReceived,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout waiting for onMessages")),
          5_000,
        ),
      ),
    ]);

    // Collect all messages across however many batches fs.watch produced
    const allMessages = batches.flatMap((b) => b.messages);
    expect(allMessages).toHaveLength(2);

    // Verify correct message kinds
    expect(allMessages[0].kind).toBe("user-prompt");
    expect(allMessages[1].kind).toBe("assistant-block");

    // Verify lineIndex assignment
    expect(allMessages[0].lineIndex).toBe(0);
    expect(allMessages[1].lineIndex).toBe(1);

    // Verify byteRange covers entire written content
    const firstStart = batches[0].byteRange.start;
    const lastEnd = batches[batches.length - 1].byteRange.end;
    expect(firstStart).toBe(0);
    const expectedBytes = Buffer.byteLength(
      userLine + "\n" + assistantLine + "\n",
    );
    expect(lastEnd).toBe(expectedBytes);

    // Verify handle state advanced
    expect(handle.byteOffset).toBe(expectedBytes);
    expect(handle.lineIndex).toBe(2);
  });

  it("only tails new content appended after watcher starts", async () => {
    tmp = await createTempJsonl();

    // Pre-populate the file with one line before starting the watcher
    const preExistingLine = toLine(makeUserPrompt("Pre-existing"));
    await appendLines(tmp.path, [preExistingLine]);
    const initialSize = Bun.file(tmp.path).size;

    const batches: WatchBatch[] = [];
    let resolve: () => void;
    const received = new Promise<void>((r) => {
      resolve = r;
    });

    handle = watchSession({
      sessionId: "test-tail-only",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        resolve();
      },
      onError: () => {},
    });

    // Watcher should start at the end of the pre-existing content
    expect(handle.byteOffset).toBe(initialSize);

    // Append a new line
    const newLine = toLine(makeAssistantRecord(makeTextBlock("New content")));
    await appendLines(tmp.path, [newLine]);

    await Promise.race([
      received,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout waiting for onMessages")),
          5_000,
        ),
      ),
    ]);

    const allMessages = batches.flatMap((b) => b.messages);
    expect(allMessages).toHaveLength(1);
    expect(allMessages[0].kind).toBe("assistant-block");

    // byteRange should start where the pre-existing content ended
    expect(batches[0].byteRange.start).toBe(initialSize);
  });
});

describe("watchSession — two-phase debounce", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("coalesces rapid writes into few batches with default debounce", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];
    let totalMessages = 0;

    handle = watchSession({
      sessionId: "test-debounce-coalesce",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        totalMessages += batch.messages.length;
      },
      onError: () => {},
      // Use default debounceMs (100) and maxWaitMs (500)
    });

    // Write 10 lines in a tight loop (< 1ms between writes)
    const lines = Array.from({ length: 10 }, (_, i) =>
      toLine(makeUserPrompt(`Line ${i}`)),
    );
    for (const line of lines) {
      await appendLines(tmp.path, [line]);
    }

    // Wait for debounce (100ms) + fs.watch delivery buffer
    await new Promise((r) => setTimeout(r, 1000));

    // All 10 messages should be delivered across 1-2 batches
    expect(totalMessages).toBe(10);
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.length).toBeLessThanOrEqual(2);
  });

  it("max-wait ceiling ensures periodic flushes during sustained writes", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];
    let totalMessages = 0;

    handle = watchSession({
      sessionId: "test-max-wait",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        totalMessages += batch.messages.length;
      },
      onError: () => {},
      debounceMs: 100,
      maxWaitMs: 500,
    });

    // Write 1 line every 50ms for 2 seconds (40 lines)
    for (let i = 0; i < 40; i++) {
      await appendLines(tmp.path, [toLine(makeUserPrompt(`Line ${i}`))]);
      await new Promise((r) => setTimeout(r, 50));
    }

    // Wait for final debounce flush after writes stop
    await new Promise((r) => setTimeout(r, 300));

    // With writes every 50ms, the trailing timer (100ms) keeps resetting.
    // The max-wait timer (500ms) forces periodic flushes.
    // Over 2 seconds, we should get at least 4 flushes.
    expect(batches.length).toBeGreaterThanOrEqual(4);
    expect(totalMessages).toBe(40);
  });
});

describe("watchSession — partial line buffering", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("buffers partial line and delivers only after completing newline", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];
    let resolve: () => void;
    const received = new Promise<void>((r) => {
      resolve = r;
    });

    handle = watchSession({
      sessionId: "test-partial-buffer",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        resolve();
      },
      onError: () => {},
    });

    // Write first half of a JSON line (no trailing newline)
    const fullLine = toLine(makeUserPrompt("Split line"));
    const half1 = fullLine.slice(0, Math.floor(fullLine.length / 2));
    const half2 = fullLine.slice(Math.floor(fullLine.length / 2)) + "\n";

    await appendRaw(tmp.path, half1);

    // Give fs.watch time to fire and process the partial write
    await new Promise((r) => setTimeout(r, 200));

    // No messages should have been delivered yet (line is incomplete)
    expect(batches).toHaveLength(0);

    // Now complete the line with the second half + newline
    await appendRaw(tmp.path, half2);

    await Promise.race([
      received,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout waiting for onMessages")),
          5_000,
        ),
      ),
    ]);

    // Exactly one message should be delivered now
    const allMessages = batches.flatMap((b) => b.messages);
    expect(allMessages).toHaveLength(1);
    expect(allMessages[0].kind).toBe("user-prompt");
    expect(allMessages[0].lineIndex).toBe(0);
  });

  it("lineBuffer is empty after a complete-line write", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];
    let resolve: () => void;
    const received = new Promise<void>((r) => {
      resolve = r;
    });

    handle = watchSession({
      sessionId: "test-complete-line",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        resolve();
      },
      onError: () => {},
    });

    // Append a complete line (with trailing newline)
    const line = toLine(makeUserPrompt("Complete"));
    await appendLines(tmp.path, [line]);

    await Promise.race([
      received,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout waiting for onMessages")),
          5_000,
        ),
      ),
    ]);

    expect(batches.flatMap((b) => b.messages)).toHaveLength(1);

    // After processing a complete line, byteOffset should equal file size
    // (meaning no leftover partial bytes were buffered)
    expect(handle!.byteOffset).toBe(Bun.file(tmp.path).size);
    expect(handle!.lineIndex).toBe(1);
  });
});

describe("watchSession — stop & teardown", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("final-flushes pending messages on stopWatching before debounce fires", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];

    handle = watchSession({
      sessionId: "test-stop-flush",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
      },
      onError: () => {},
      debounceMs: 5_000, // Very long so it won't fire naturally
      maxWaitMs: 10_000,
    });

    // Append a line
    await appendLines(tmp.path, [toLine(makeUserPrompt("Pending"))]);

    // Wait for fs.watch to fire and process the write (but debounce won't flush)
    await new Promise((r) => setTimeout(r, 200));

    // No batch delivered yet (debounce is 5 seconds)
    expect(batches).toHaveLength(0);

    // Stop the watcher — should final-flush the pending message
    stopWatching(handle!);

    expect(batches).toHaveLength(1);
    expect(batches[0].messages).toHaveLength(1);
    expect(batches[0].messages[0].kind).toBe("user-prompt");
    expect(handle!.stopped).toBe(true);
  });

  it("no callbacks fire after stopWatching even when file is appended to", async () => {
    tmp = await createTempJsonl();

    let callbackCount = 0;

    handle = watchSession({
      sessionId: "test-stop-silence",
      filePath: tmp.path,
      onMessages: () => {
        callbackCount++;
      },
      onError: () => {},
      debounceMs: 50,
      maxWaitMs: 100,
    });

    // Append and wait for delivery
    await appendLines(tmp.path, [toLine(makeUserPrompt("Before stop"))]);
    await new Promise((r) => setTimeout(r, 300));
    expect(callbackCount).toBe(1);

    // Stop the watcher
    stopWatching(handle!);
    expect(handle!.stopped).toBe(true);

    // Append more lines after stopping
    await appendLines(tmp.path, [toLine(makeUserPrompt("After stop"))]);
    await new Promise((r) => setTimeout(r, 300));

    // No additional callbacks should have fired
    expect(callbackCount).toBe(1);
  });

  it("stopAll stops all watchers and prevents further callbacks", async () => {
    const tmps: TempJsonl[] = [];
    const handles: WatchHandle[] = [];
    let callbackCount = 0;

    try {
      for (let i = 0; i < 3; i++) {
        const t = await createTempJsonl();
        tmps.push(t);
        const h = watchSession({
          sessionId: `test-stop-all-${i}`,
          filePath: t.path,
          onMessages: () => {
            callbackCount++;
          },
          onError: () => {},
          debounceMs: 50,
          maxWaitMs: 100,
        });
        handles.push(h);
      }

      // Append a line to each and wait for delivery
      for (const t of tmps) {
        await appendLines(t.path, [
          toLine(makeUserPrompt("Before stopAll")),
        ]);
      }
      await new Promise((r) => setTimeout(r, 300));
      expect(callbackCount).toBe(3);

      // Stop all
      stopAll();

      // All handles should be stopped
      for (const h of handles) {
        expect(h.stopped).toBe(true);
      }

      // Append more lines after stopAll
      for (const t of tmps) {
        await appendLines(t.path, [
          toLine(makeUserPrompt("After stopAll")),
        ]);
      }
      await new Promise((r) => setTimeout(r, 300));

      // No additional callbacks
      expect(callbackCount).toBe(3);
    } finally {
      for (const t of tmps) {
        await t.cleanup();
      }
    }
  });
});

describe("watchSession — registry & duplicate prevention", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("returns existing handle when watchSession is called twice with same sessionId", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];
    let totalMessages = 0;
    let resolve: () => void;
    const received = new Promise<void>((r) => {
      resolve = r;
    });

    const sharedOpts = {
      sessionId: "test-duplicate",
      filePath: tmp.path,
      onError: () => {},
    };

    // First call — creates the watcher
    handle = watchSession({
      ...sharedOpts,
      onMessages: (batch) => {
        batches.push(batch);
        totalMessages += batch.messages.length;
        if (totalMessages >= 1) resolve();
      },
    });

    // Second call with the same sessionId — should return the same handle
    const handle2 = watchSession({
      ...sharedOpts,
      onMessages: () => {
        throw new Error("Second onMessages should never be called");
      },
    });

    expect(handle2).toBe(handle);

    // Append a line — only the first callback should fire
    await appendLines(tmp.path, [toLine(makeUserPrompt("Dedup test"))]);

    await Promise.race([
      received,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout waiting for onMessages")),
          5_000,
        ),
      ),
    ]);

    const allMessages = batches.flatMap((b) => b.messages);
    expect(allMessages).toHaveLength(1);
    expect(allMessages[0].kind).toBe("user-prompt");
  });
});

describe("watchSession — file truncation recovery", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("recovers from file truncation by resetting and re-reading from beginning", async () => {
    tmp = await createTempJsonl();

    // Pre-populate with enough content so the watcher starts at a high offset
    const preLines = Array.from({ length: 8 }, (_, i) =>
      toLine(makeUserPrompt(`Pre-truncate padding line ${i} with extra text`)),
    );
    await appendLines(tmp.path, preLines);
    const preSize = Bun.file(tmp.path).size;
    // Sanity: pre-populated file should be well over 500 bytes
    expect(preSize).toBeGreaterThan(500);

    const batches: WatchBatch[] = [];
    let totalMessages = 0;
    let resolve: () => void;
    const received = new Promise<void>((r) => {
      resolve = r;
    });

    handle = watchSession({
      sessionId: "test-truncation",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        totalMessages += batch.messages.length;
        if (totalMessages >= 1) resolve();
      },
      onError: () => {},
    });

    // Watcher should start at the end of the pre-existing content
    expect(handle.byteOffset).toBe(preSize);

    // Truncate the file to zero bytes
    await truncateFile(tmp.path);

    // Give fs.watch time to process the truncation event
    await new Promise((r) => setTimeout(r, 200));

    // Write new content after truncation
    const newLine = toLine(
      makeAssistantRecord(makeTextBlock("After truncation")),
    );
    await appendLines(tmp.path, [newLine]);

    await Promise.race([
      received,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout waiting for onMessages")),
          5_000,
        ),
      ),
    ]);

    // Verify new content was delivered with reset lineIndex
    const allMessages = batches.flatMap((b) => b.messages);
    expect(allMessages).toHaveLength(1);
    expect(allMessages[0].kind).toBe("assistant-block");
    expect(allMessages[0].lineIndex).toBe(0); // lineIndex reset after truncation

    // Handle state should reflect the reset
    expect(handle!.lineIndex).toBe(1);
  });
});

describe("watchSession — blank & malformed lines", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("skips blank lines without advancing lineIndex or flushing a batch", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];

    handle = watchSession({
      sessionId: "test-blank-lines",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
      },
      onError: () => {},
      debounceMs: 50,
      maxWaitMs: 100,
    });

    expect(handle.byteOffset).toBe(0);
    expect(handle.lineIndex).toBe(0);

    // Append two blank lines (just newlines)
    await appendRaw(tmp.path, "\n\n");

    // Wait for fs.watch to fire and process
    await new Promise((r) => setTimeout(r, 300));

    // No batch should have been flushed (blank lines produce no messages)
    expect(batches).toHaveLength(0);

    // byteOffset should have advanced past the two newline bytes
    expect(handle.byteOffset).toBe(2);

    // lineIndex should not have advanced (blank lines are skipped)
    expect(handle.lineIndex).toBe(0);
  });

  it("delivers MalformedRecord for invalid JSON with correct lineIndex", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];
    let totalMessages = 0;
    let resolve: () => void;
    const allReceived = new Promise<void>((r) => {
      resolve = r;
    });

    handle = watchSession({
      sessionId: "test-malformed",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        totalMessages += batch.messages.length;
        if (totalMessages >= 2) resolve();
      },
      onError: () => {},
    });

    // Append invalid JSON followed by a valid line
    await appendRaw(tmp.path, "this is not valid json\n");

    // Wait for the malformed message to be processed
    await new Promise((r) => setTimeout(r, 300));

    // Append a valid line to verify watcher continues
    const validLine = toLine(makeUserPrompt("After malformed"));
    await appendLines(tmp.path, [validLine]);

    await Promise.race([
      allReceived,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout waiting for onMessages")),
          5_000,
        ),
      ),
    ]);

    const allMessages = batches.flatMap((b) => b.messages);
    expect(allMessages).toHaveLength(2);

    // First message should be a MalformedRecord at lineIndex 0
    expect(allMessages[0].kind).toBe("malformed");
    expect(allMessages[0].lineIndex).toBe(0);
    expect((allMessages[0] as { raw: string }).raw).toBe(
      "this is not valid json",
    );

    // Second message should be the valid user-prompt at lineIndex 1
    expect(allMessages[1].kind).toBe("user-prompt");
    expect(allMessages[1].lineIndex).toBe(1);

    // lineIndex should have advanced past both lines
    expect(handle!.lineIndex).toBe(2);
  });
});

describe("watchSession — error resilience", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    // Restore permissions before cleanup (in case test left file unreadable)
    if (tmp) {
      try {
        await chmod(tmp.path, 0o644);
      } catch {}
    }
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("emits READ_ERROR on read failure and continues watching on next event", async () => {
    tmp = await createTempJsonl();

    const errors: WatchError[] = [];
    const batches: WatchBatch[] = [];
    let resolve: () => void;
    const received = new Promise<void>((r) => {
      resolve = r;
    });

    handle = watchSession({
      sessionId: "test-read-error",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        resolve();
      },
      onError: (err) => {
        errors.push(err);
      },
    });

    // Make file write-only (stat works, write works, read fails)
    await chmod(tmp.path, 0o200);

    // Append data — triggers fs.watch but the read will fail
    const line1 = toLine(makeUserPrompt("During unreadable"));
    await appendLines(tmp.path, [line1]);

    // Wait for fs.watch to fire and the read to fail
    await new Promise((r) => setTimeout(r, 300));

    // Should have emitted a READ_ERROR
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].code).toBe("READ_ERROR");
    expect(errors[0].sessionId).toBe("test-read-error");
    expect(errors[0].cause).toBeInstanceOf(Error);

    // Watcher should still be alive (not stopped)
    expect(handle!.stopped).toBe(false);

    // Restore read permissions
    await chmod(tmp.path, 0o644);

    // Append a new line — watcher should recover and deliver it
    const line2 = toLine(makeAssistantRecord(makeTextBlock("After recovery")));
    await appendLines(tmp.path, [line2]);

    await Promise.race([
      received,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout waiting for recovery")),
          5_000,
        ),
      ),
    ]);

    // Messages should have been delivered after recovery
    expect(batches.length).toBeGreaterThanOrEqual(1);
    const allMessages = batches.flatMap((b) => b.messages);
    expect(allMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("emits WATCH_ERROR and auto-stops when fs.watch errors", async () => {
    tmp = await createTempJsonl();

    const errors: WatchError[] = [];

    handle = watchSession({
      sessionId: "test-watch-error",
      filePath: tmp.path,
      onMessages: () => {},
      onError: (err) => {
        errors.push(err);
      },
    });

    expect(handle!.stopped).toBe(false);

    // Get the internal FSWatcher and emit an error
    const state = _registry.get("test-watch-error");
    expect(state).toBeDefined();
    state!.watcher.emit("error", new Error("simulated watcher failure"));

    // Error should have been emitted
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("WATCH_ERROR");
    expect(errors[0].sessionId).toBe("test-watch-error");
    expect(errors[0].cause).toBeInstanceOf(Error);
    expect(errors[0].cause!.message).toBe("simulated watcher failure");

    // Watcher should have been auto-stopped
    expect(handle!.stopped).toBe(true);

    // Registry should no longer contain this session
    expect(_registry.has("test-watch-error")).toBe(false);
  });
});

describe("watchSession — end-to-end consistency", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("batched messages match parseLine output exactly for real fixture data", async () => {
    tmp = await createTempJsonl();

    // Read the real fixture file
    const fixturePath = join(
      import.meta.dir,
      "../../parser/__tests__/fixtures/minimal-session.jsonl",
    );
    const fixtureContent = await readFile(fixturePath, "utf-8");
    const fixtureLines = fixtureContent
      .split("\n")
      .filter((l) => l.trim() !== "");

    // Compute expected messages using parseLine directly
    const expected = fixtureLines
      .map((line, idx) => parseLine(line, idx))
      .filter((m) => m !== null);

    const batches: WatchBatch[] = [];
    let totalMessages = 0;
    let resolve: () => void;
    const allReceived = new Promise<void>((r) => {
      resolve = r;
    });

    handle = watchSession({
      sessionId: "test-e2e-consistency",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        totalMessages += batch.messages.length;
        if (totalMessages >= expected.length) resolve();
      },
      onError: () => {},
      debounceMs: 0,
      maxWaitMs: 0,
    });

    // Append fixture lines one-by-one
    for (const line of fixtureLines) {
      await appendLines(tmp.path, [line]);
    }

    await Promise.race([
      allReceived,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout waiting for all fixture messages")),
          10_000,
        ),
      ),
    ]);

    const allMessages = batches.flatMap((b) => b.messages);

    // Same count
    expect(allMessages).toHaveLength(expected.length);

    // Order, lineIndex, and content match exactly
    for (let i = 0; i < expected.length; i++) {
      expect(allMessages[i].kind).toBe(expected[i].kind);
      expect(allMessages[i].lineIndex).toBe(expected[i].lineIndex);
      // Deep equality on the full message object
      expect(allMessages[i]).toEqual(expected[i]);
    }

    // byteRange covers the entire file
    const firstStart = batches[0].byteRange.start;
    const lastEnd = batches[batches.length - 1].byteRange.end;
    expect(firstStart).toBe(0);
    expect(lastEnd).toBe(Bun.file(tmp.path).size);
  });
});

describe("watchSession — 100-write stress test", () => {
  let tmp: TempJsonl | null = null;
  let handle: WatchHandle | null = null;

  afterEach(async () => {
    stopAll();
    handle = null;
    if (tmp) await tmp.cleanup();
    tmp = null;
  });

  it("delivers exactly 100 messages with no duplicates and no drops", async () => {
    tmp = await createTempJsonl();

    const batches: WatchBatch[] = [];
    let totalMessages = 0;
    let resolve: () => void;
    const allReceived = new Promise<void>((r) => {
      resolve = r;
    });

    handle = watchSession({
      sessionId: "test-stress-100",
      filePath: tmp.path,
      onMessages: (batch) => {
        batches.push(batch);
        totalMessages += batch.messages.length;
        if (totalMessages >= 100) resolve();
      },
      onError: () => {},
    });

    // Append 100 valid JSONL lines in sequence
    for (let i = 0; i < 100; i++) {
      await appendLines(tmp.path, [toLine(makeUserPrompt(`Stress line ${i}`))]);
    }

    await Promise.race([
      allReceived,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Timeout: got ${totalMessages}/100 messages, ` +
                  `byteOffset=${handle!.byteOffset}, fileSize=${Bun.file(tmp!.path).size}`,
              ),
            ),
          15_000,
        ),
      ),
    ]);

    const allMessages = batches.flatMap((b) => b.messages);

    // Exactly 100 messages — no drops
    expect(allMessages).toHaveLength(100);

    // Correct lineIndex sequence — no duplicates, no gaps
    for (let i = 0; i < 100; i++) {
      expect(allMessages[i].lineIndex).toBe(i);
      expect(allMessages[i].kind).toBe("user-prompt");
    }

    // byteRange covers the entire file
    const firstStart = batches[0].byteRange.start;
    const lastEnd = batches[batches.length - 1].byteRange.end;
    expect(firstStart).toBe(0);
    expect(lastEnd).toBe(Bun.file(tmp.path).size);

    // Handle state consistent
    expect(handle!.lineIndex).toBe(100);
    expect(handle!.byteOffset).toBe(Bun.file(tmp.path).size);
  }, 20_000);
});
