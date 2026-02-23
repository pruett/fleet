import { describe, expect, it, afterEach } from "bun:test";
import { watchSession, stopWatching, stopAll } from "..";
import type { WatchBatch, WatchHandle } from "../types";
import { createTempJsonl, appendLines, appendRaw, type TempJsonl } from "./helpers";
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
