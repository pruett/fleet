import { describe, expect, it, afterEach } from "bun:test";
import { watchSession, stopWatching, stopAll } from "..";
import type { WatchBatch, WatchHandle } from "../types";
import { createTempJsonl, appendLines, type TempJsonl } from "./helpers";
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
