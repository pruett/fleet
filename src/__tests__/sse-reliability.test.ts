/**
 * SSE reliability stress tests.
 *
 * These tests exercise the full pipeline under conditions that expose
 * message-drop bugs:
 *
 *   File append → fs.watch/poll → processChanges → flush → onMessages
 *     → pushEvent → controller.enqueue → SSE stream → client frame parse
 *
 * Each test instruments multiple layers so failures pinpoint WHERE
 * messages are lost rather than just WHETHER they are lost.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { createApp } from "../api/create-app";
import { createRealtime } from "../realtime";
import { watchSession, stopWatching, stopAll } from "../watcher/watch-session";
import { parseFullSession } from "../parser";
import { createTempJsonl, appendLines } from "../watcher/__tests__/helpers";
import {
  makeUserPrompt,
  makeAssistantRecord,
  makeTextBlock,
  toLine,
} from "../parser/__tests__/helpers";
import type { Realtime } from "../realtime";
import type { AppDependencies } from "../api/types";

// ---------------------------------------------------------------------------
// SSE frame parsing (same as sse-data-flow.test.ts)
// ---------------------------------------------------------------------------

interface SseFrame {
  event: string;
  data: unknown;
}

async function readSseFrames(
  response: Response,
  durationMs: number,
): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + durationMs;

  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      wait(Math.max(1, deadline - Date.now())).then(() => null),
    ]);
    if (result === null || result.done) break;

    buffer += decoder.decode(result.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;

    for (const part of parts) {
      if (!part.trim() || part.startsWith(":")) continue;
      let event = "message";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (data) {
        try {
          frames.push({ event, data: JSON.parse(data) });
        } catch {
          frames.push({ event, data });
        }
      }
    }
  }

  await reader.cancel();
  reader.releaseLock();
  return frames;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Instrumented test harness
// ---------------------------------------------------------------------------

interface InstrumentedHarness {
  app: ReturnType<typeof createApp>;
  realtime: Realtime;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  /** Messages seen by the watcher's onMessages callback (= what realtime receives). */
  watcherBatches: Array<{ sessionId: string; count: number; lineIndexes: number[] }>;
}

function createInstrumentedHarness(pathMap: Map<string, string>): InstrumentedHarness {
  const watcherBatches: InstrumentedHarness["watcherBatches"] = [];

  // Wrap watchSession to intercept onMessages (the watcher→realtime boundary)
  const instrumentedWatchSession: typeof watchSession = (opts) => {
    const originalOnMessages = opts.onMessages;
    return watchSession({
      ...opts,
      onMessages: (batch) => {
        watcherBatches.push({
          sessionId: batch.sessionId,
          count: batch.messages.length,
          lineIndexes: batch.messages.map((m) => m.lineIndex),
        });
        console.debug(
          `[test:watcher] batch: ${batch.messages.length} messages, lineIndexes=[${batch.messages.map((m) => m.lineIndex).join(",")}], byteRange=${batch.byteRange.start}-${batch.byteRange.end}`,
        );
        originalOnMessages(batch);
      },
    });
  };

  const realtime = createRealtime({
    watchSession: instrumentedWatchSession,
    stopWatching,
    resolveSessionPath: async (id) => pathMap.get(id) ?? null,
    parseSession: parseFullSession,
  });

  const deps: AppDependencies = {
    scanner: {
      scanProjects: async () => [],
      scanSessions: async () => [],
      groupProjects: () => [],
      scanWorktrees: async () => [],
    },
    parser: { parseFullSession },
    controller: {
      startSession: async () => ({ ok: true, sessionId: "mock" }),
      stopSession: async () => ({ ok: true, sessionId: "mock" }),
      resumeSession: async () => ({ ok: true, sessionId: "mock" }),
      sendMessage: async () => ({ ok: true, sessionId: "mock" }),
    },
    config: {
      readConfig: async () => ({ projects: [] }),
      writeConfig: async () => {},
    },
    realtime,
    basePaths: [],
    staticDir: null,
  };

  const app = createApp(deps);

  return {
    app,
    realtime,
    request: (path, init) => Promise.resolve(app.request(`http://localhost${path}`, init)),
    watcherBatches,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSE reliability — stress tests", () => {
  let harness: InstrumentedHarness;
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    harness?.realtime.shutdown();
    stopAll();
    for (const fn of cleanups) await fn();
    cleanups.length = 0;
  });

  // =========================================================================
  // 1. Rapid sequential appends — every message must arrive
  // =========================================================================

  test("rapid sequential appends: all messages arrive through SSE", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createInstrumentedHarness(new Map([[sessionId, temp.path]]));

    // Connect SSE
    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    // Rapidly append 20 messages with no delay between them
    const MESSAGE_COUNT = 20;
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      await appendLines(temp.path, [
        toLine(makeUserPrompt(`msg-${i}`) as Record<string, unknown>),
      ]);
    }

    // Wait for debounce to flush (500ms max-wait + margin)
    await wait(800);

    const frames = await readSseFrames(res, 200);

    // --- Layer 1: Watcher → Realtime (onMessages callback) ---
    const watcherMessageCount = harness.watcherBatches.reduce(
      (sum, b) => sum + b.count,
      0,
    );
    console.log(
      `[result:watcher] ${watcherMessageCount}/${MESSAGE_COUNT} messages in ${harness.watcherBatches.length} batches`,
    );

    // --- Layer 2: SSE stream (realtime → client) ---
    const messageBatches = frames.filter((f) => f.event === "messages");
    const sseMessages = messageBatches.flatMap(
      (f) => (f.data as Record<string, unknown>).messages as Array<{ text?: string }>,
    );
    console.log(
      `[result:sse] ${sseMessages.length}/${MESSAGE_COUNT} messages in ${messageBatches.length} SSE frames`,
    );

    // Verify every message arrived at each layer
    const receivedTexts = new Set(sseMessages.map((m) => m.text));
    const missing: string[] = [];
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      if (!receivedTexts.has(`msg-${i}`)) missing.push(`msg-${i}`);
    }

    if (missing.length > 0) {
      console.error(`[result] MISSING messages: ${missing.join(", ")}`);
    }

    expect(watcherMessageCount).toBe(MESSAGE_COUNT);
    expect(sseMessages.length).toBe(MESSAGE_COUNT);
    expect(missing).toHaveLength(0);
  });

  // =========================================================================
  // 2. Burst + pause + burst — tests debounce boundary behavior
  // =========================================================================

  test("burst-pause-burst: messages across debounce boundaries all arrive", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createInstrumentedHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    // Burst 1: 5 messages rapidly
    for (let i = 0; i < 5; i++) {
      await appendLines(temp.path, [
        toLine(makeUserPrompt(`burst1-${i}`) as Record<string, unknown>),
      ]);
    }

    // Pause longer than max-wait to force a flush
    await wait(700);

    // Burst 2: 5 more messages
    for (let i = 0; i < 5; i++) {
      await appendLines(temp.path, [
        toLine(makeUserPrompt(`burst2-${i}`) as Record<string, unknown>),
      ]);
    }

    await wait(700);

    const frames = await readSseFrames(res, 200);
    const messageBatches = frames.filter((f) => f.event === "messages");
    const allMessages = messageBatches.flatMap(
      (f) => (f.data as Record<string, unknown>).messages as Array<{ text?: string }>,
    );

    const receivedTexts = new Set(allMessages.map((m) => m.text));
    console.log(`[result] received ${allMessages.length}/10 messages across ${messageBatches.length} batches`);

    // All 10 must arrive
    for (let i = 0; i < 5; i++) {
      expect(receivedTexts.has(`burst1-${i}`)).toBe(true);
      expect(receivedTexts.has(`burst2-${i}`)).toBe(true);
    }
    expect(allMessages.length).toBe(10);
  });

  // =========================================================================
  // 3. Append DURING snapshot — the gap between read and watcher start
  // =========================================================================

  test("messages appended during snapshot-to-watcher gap are not lost", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    // Pre-populate with content so the snapshot has something
    await appendLines(temp.path, [
      toLine(makeUserPrompt("pre-existing") as Record<string, unknown>),
    ]);

    const sessionId = crypto.randomUUID();

    // Start appending BEFORE the SSE connection is fully established
    // This simulates Claude actively writing while the user opens the page
    const appendPromise = (async () => {
      // Small delay to let the snapshot read start but not finish watcher setup
      await wait(5);
      for (let i = 0; i < 5; i++) {
        await appendLines(temp.path, [
          toLine(makeUserPrompt(`gap-${i}`) as Record<string, unknown>),
        ]);
        await wait(2);
      }
    })();

    harness = createInstrumentedHarness(new Map([[sessionId, temp.path]]));
    const res = await harness.request(`/api/sse/sessions/${sessionId}`);

    await appendPromise;
    await wait(800);

    const frames = await readSseFrames(res, 200);

    // Snapshot messages
    const snapshot = frames.find((f) => f.event === "snapshot");
    const snapshotMessages = (
      (snapshot!.data as Record<string, unknown>).session as Record<string, unknown>
    ).messages as Array<{ text?: string }>;
    const snapshotTexts = new Set(snapshotMessages.map((m) => m.text));

    // Delta messages
    const deltaMessages = frames
      .filter((f) => f.event === "messages")
      .flatMap(
        (f) => (f.data as Record<string, unknown>).messages as Array<{ text?: string; lineIndex?: number }>,
      );
    const deltaTexts = new Set(deltaMessages.map((m) => m.text));

    console.log(`[result] snapshot: ${snapshotMessages.length} messages (${[...snapshotTexts].join(", ")})`);
    console.log(`[result] deltas: ${deltaMessages.length} messages (${[...deltaTexts].join(", ")})`);

    // Every gap-N message must appear in EITHER snapshot or delta (no gap)
    for (let i = 0; i < 5; i++) {
      const key = `gap-${i}`;
      const inSnapshot = snapshotTexts.has(key);
      const inDelta = deltaTexts.has(key);
      console.log(`  ${key}: snapshot=${inSnapshot}, delta=${inDelta}`);
      expect(inSnapshot || inDelta).toBe(true);
    }
  });

  // =========================================================================
  // 4. Large batch — ensures no truncation or buffer overflow
  // =========================================================================

  test("large single append (50 lines) all arrive as messages", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createInstrumentedHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    // Single append of 50 lines at once
    const lines = Array.from({ length: 50 }, (_, i) =>
      toLine(makeUserPrompt(`bulk-${i}`) as Record<string, unknown>),
    );
    await appendLines(temp.path, lines);

    await wait(800);

    const frames = await readSseFrames(res, 200);
    const allMessages = frames
      .filter((f) => f.event === "messages")
      .flatMap(
        (f) => (f.data as Record<string, unknown>).messages as Array<{ text?: string }>,
      );

    console.log(`[result] ${allMessages.length}/50 bulk messages received`);
    expect(allMessages.length).toBe(50);

    const receivedTexts = new Set(allMessages.map((m) => m.text));
    for (let i = 0; i < 50; i++) {
      expect(receivedTexts.has(`bulk-${i}`)).toBe(true);
    }
  });

  // =========================================================================
  // 5. Trickle — one message at a time with small delays
  // =========================================================================

  test("trickle: messages arriving one at a time with small delays", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createInstrumentedHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    const MESSAGE_COUNT = 10;
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      await appendLines(temp.path, [
        toLine(makeUserPrompt(`trickle-${i}`) as Record<string, unknown>),
      ]);
      // 150ms apart — longer than trailing debounce (100ms), so each should
      // flush individually or in very small batches
      await wait(150);
    }

    await wait(600);

    const frames = await readSseFrames(res, 200);
    const allMessages = frames
      .filter((f) => f.event === "messages")
      .flatMap(
        (f) => (f.data as Record<string, unknown>).messages as Array<{ text?: string }>,
      );

    console.log(
      `[result] trickle: ${allMessages.length}/${MESSAGE_COUNT} in ${frames.filter((f) => f.event === "messages").length} batches`,
    );

    const receivedTexts = new Set(allMessages.map((m) => m.text));
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      expect(receivedTexts.has(`trickle-${i}`)).toBe(true);
    }
    expect(allMessages.length).toBe(MESSAGE_COUNT);
  });

  // =========================================================================
  // 6. lineIndex continuity — no gaps or duplicates in lineIndex values
  // =========================================================================

  test("lineIndex values are continuous with no gaps or duplicates", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    // Pre-populate with 3 messages (lineIndexes 0, 1, 2)
    await appendLines(temp.path, [
      toLine(makeUserPrompt("pre-0") as Record<string, unknown>),
      toLine(makeAssistantRecord(makeTextBlock("pre-1")) as Record<string, unknown>),
      toLine(makeUserPrompt("pre-2") as Record<string, unknown>),
    ]);

    const sessionId = crypto.randomUUID();
    harness = createInstrumentedHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    // Append 5 more (should get lineIndexes 3, 4, 5, 6, 7)
    for (let i = 0; i < 5; i++) {
      await appendLines(temp.path, [
        toLine(makeUserPrompt(`live-${i}`) as Record<string, unknown>),
      ]);
    }
    await wait(800);

    const frames = await readSseFrames(res, 200);

    // Collect all lineIndexes from snapshot + deltas
    const snapshot = frames.find((f) => f.event === "snapshot");
    const snapshotMessages = (
      (snapshot!.data as Record<string, unknown>).session as Record<string, unknown>
    ).messages as Array<{ lineIndex: number }>;
    const snapshotIndexes = snapshotMessages.map((m) => m.lineIndex);

    const deltaMessages = frames
      .filter((f) => f.event === "messages")
      .flatMap(
        (f) => (f.data as Record<string, unknown>).messages as Array<{ lineIndex: number }>,
      );
    const deltaIndexes = deltaMessages.map((m) => m.lineIndex);

    console.log(`[result] snapshot lineIndexes: [${snapshotIndexes.join(",")}]`);
    console.log(`[result] delta lineIndexes: [${deltaIndexes.join(",")}]`);

    // Snapshot indexes should be [0, 1, 2] (the pre-populated messages)
    // Some messages may include non-parseable lines, so check for monotonicity
    const allIndexes = [...snapshotIndexes, ...deltaIndexes].sort((a, b) => a - b);

    // No duplicates between snapshot and delta
    const snapshotSet = new Set(snapshotIndexes);
    const overlap = deltaIndexes.filter((idx) => snapshotSet.has(idx));
    console.log(`[result] overlap between snapshot and delta: [${overlap.join(",")}]`);
    expect(overlap).toHaveLength(0);

    // No gaps in the combined sequence
    for (let i = 1; i < allIndexes.length; i++) {
      const gap = allIndexes[i] - allIndexes[i - 1];
      if (gap !== 1) {
        console.error(
          `[result] GAP: lineIndex ${allIndexes[i - 1]} → ${allIndexes[i]} (gap=${gap})`,
        );
      }
      expect(gap).toBe(1);
    }
  });
});
