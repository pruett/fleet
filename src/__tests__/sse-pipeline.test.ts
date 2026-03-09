/**
 * Integration tests for the SSE pipeline.
 *
 * Architecture under test:
 *   CLI writes JSONL → File Watcher (fs.watch + tail) → Parser (parseLine)
 *   → SSE (pushEvent) → SSE Client
 *
 * These tests wire the REAL watcher and REAL SSE service together with:
 *   - SSE Response streams (no network layer)
 *   - Temp JSONL files (real filesystem)
 *   - Real parser (parseLine via the watcher)
 *
 * Each test uses crypto.randomUUID() for sessionIds to avoid collisions
 * in the module-level watcher registry.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { createSse } from "../sse/create-sse";
import {
  watchSession,
  stopWatching,
  stopAll,
  _registry,
} from "../watcher/watch-session";
import { createTempJsonl, appendLines } from "../watcher/__tests__/helpers";
import {
  collectSseEvents,
  flushAsync,
  waitMs,
} from "../sse/__tests__/helpers";
import {
  makeUserPrompt,
  makeAssistantRecord,
  makeTextBlock,
  toLine,
} from "../parser/__tests__/helpers";
import { parseFullSession } from "../parser";
import type { Sse } from "../sse/types";
import type { SseEvent } from "../sse/__tests__/helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** How long to wait for the watcher's debounce timer (default 100ms) to flush. */
const DEBOUNCE_WAIT = 300;

/** Create an SSE service wired to the real watcher with a path lookup map. */
function createRealSseService(pathMap: Map<string, string>): Sse {
  return createSse({
    watchSession,
    stopWatching,
    resolveSessionPath: async (id) => pathMap.get(id) ?? null,
    parseSession: parseFullSession,
  });
}

/** Connect an SSE client to the SSE service for a given session. */
async function connectClient(sse: Sse, sessionId: string) {
  const response = await sse.handleSessionStream(sessionId);
  await flushAsync();
  await flushAsync();
  return response;
}

/** Extract "messages" events from SSE events. */
function getMessageEvents(events: SseEvent[]) {
  return events.filter((e) => e.type === "messages");
}

/** Collect all ParsedMessage objects delivered across all message events. */
function getDeliveredMessages(events: SseEvent[]) {
  return getMessageEvents(events).flatMap(
    (e) => (e.data as Record<string, unknown>).messages as unknown[],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSE Pipeline Integration", () => {
  let sse: Sse;
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    sse?.shutdown();
    stopAll();
    for (const fn of cleanups) await fn();
    cleanups.length = 0;
  });

  // =========================================================================
  // Test 1: Happy path — file append → watcher → sse → SSE client
  // =========================================================================

  test("file append after subscribe is delivered to SSE client", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);
    sse = createRealSseService(pathMap);

    const response = await connectClient(sse, sessionId);

    const line1 = toLine(
      makeUserPrompt("hello world") as Record<string, unknown>,
    );
    const line2 = toLine(
      makeAssistantRecord(makeTextBlock("hi there")) as Record<string, unknown>,
    );
    await appendLines(temp.path, [line1, line2]);
    await waitMs(DEBOUNCE_WAIT);

    const events = await collectSseEvents(response, 50);
    const delivered = getDeliveredMessages(events);
    expect(delivered).toHaveLength(2);

    const kinds = delivered.map((m: any) => m.kind);
    expect(kinds).toContain("user-prompt");
    expect(kinds).toContain("assistant-block");

    const userMsg = delivered.find((m: any) => m.kind === "user-prompt") as any;
    expect(userMsg.text).toBe("hello world");

    const assistantMsg = delivered.find(
      (m: any) => m.kind === "assistant-block",
    ) as any;
    expect(assistantMsg.contentBlock.text).toBe("hi there");
  });

  // =========================================================================
  // Test 2: Multi-client fan-out
  // =========================================================================

  test("one watcher relays messages to all subscribers", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);
    sse = createRealSseService(pathMap);

    const response1 = await connectClient(sse, sessionId);
    const response2 = await connectClient(sse, sessionId);

    expect(_registry.size).toBe(1);

    const line = toLine(
      makeUserPrompt("broadcast me") as Record<string, unknown>,
    );
    await appendLines(temp.path, [line]);
    await waitMs(DEBOUNCE_WAIT);

    const events1 = await collectSseEvents(response1, 50);
    const events2 = await collectSseEvents(response2, 50);
    const delivered1 = getDeliveredMessages(events1);
    const delivered2 = getDeliveredMessages(events2);
    expect(delivered1).toHaveLength(1);
    expect(delivered2).toHaveLength(1);
    expect((delivered1[0] as any).text).toBe("broadcast me");
    expect((delivered2[0] as any).text).toBe("broadcast me");
  });

  // =========================================================================
  // Test 3: Snapshot — pre-existing content arrives in snapshot event
  // =========================================================================

  test("pre-existing content is delivered via snapshot event", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);

    const line1 = toLine(
      makeUserPrompt("existing message") as Record<string, unknown>,
    );
    const line2 = toLine(
      makeAssistantRecord(
        makeTextBlock("existing response"),
      ) as Record<string, unknown>,
    );
    await appendLines(temp.path, [line1, line2]);

    sse = createRealSseService(pathMap);
    const response = await connectClient(sse, sessionId);

    const events = await collectSseEvents(response, 50);
    const snapshots = events.filter((e) => e.type === "snapshot");
    expect(snapshots).toHaveLength(1);

    const session = (snapshots[0].data as any).session;
    expect(session.messages).toHaveLength(2);
    const kinds = session.messages.map((m: any) => m.kind);
    expect(kinds).toContain("user-prompt");
    expect(kinds).toContain("assistant-block");
  });

  // =========================================================================
  // Test 4: Snapshot + live delta — no messages lost
  // =========================================================================

  test("snapshot includes existing content and watcher delivers new content", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);

    const PRE_COUNT = 5;
    const preLines = Array.from({ length: PRE_COUNT }, (_, i) =>
      toLine(
        makeUserPrompt(`pre-msg-${i}`) as Record<string, unknown>,
      ),
    );
    await appendLines(temp.path, preLines);

    sse = createRealSseService(pathMap);
    const response = await connectClient(sse, sessionId);

    const postLine = toLine(
      makeUserPrompt("post-subscribe") as Record<string, unknown>,
    );
    await appendLines(temp.path, [postLine]);
    await waitMs(DEBOUNCE_WAIT);

    const events = await collectSseEvents(response, 50);

    // Snapshot should contain pre-existing messages
    const snapshots = events.filter((e) => e.type === "snapshot");
    expect(snapshots).toHaveLength(1);
    const session = (snapshots[0].data as any).session;
    expect(session.messages).toHaveLength(PRE_COUNT);

    // Delta should contain the new message
    const delivered = getDeliveredMessages(events);
    const texts = delivered
      .filter((m: any) => m.kind === "user-prompt")
      .map((m: any) => m.text);
    expect(texts).toContain("post-subscribe");
  });

  // =========================================================================
  // Test 5: Watcher cleanup on disconnect
  // =========================================================================

  test("watcher stops when last subscriber disconnects", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);
    sse = createRealSseService(pathMap);

    const response = await connectClient(sse, sessionId);

    expect(_registry.has(sessionId)).toBe(true);

    await response.body!.cancel();
    await flushAsync();

    expect(_registry.has(sessionId)).toBe(false);
  });

  // =========================================================================
  // Test 6: Pre-existing content in snapshot, new content in messages
  // =========================================================================

  test("pre-existing content arrives in snapshot, new content in messages delta", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const preExisting = toLine(
      makeUserPrompt("I existed before the watcher") as Record<string, unknown>,
    );
    await appendLines(temp.path, [preExisting]);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);
    sse = createRealSseService(pathMap);

    const response = await connectClient(sse, sessionId);

    const newLine = toLine(
      makeUserPrompt("I am new") as Record<string, unknown>,
    );
    await appendLines(temp.path, [newLine]);
    await waitMs(DEBOUNCE_WAIT);

    const events = await collectSseEvents(response, 50);

    // Pre-existing content is in the snapshot
    const snapshots = events.filter((e) => e.type === "snapshot");
    const snapshotTexts = (snapshots[0].data as any).session.messages
      .filter((m: any) => m.kind === "user-prompt")
      .map((m: any) => m.text);
    expect(snapshotTexts).toContain("I existed before the watcher");

    // New content arrives via messages delta (not in snapshot)
    const delivered = getDeliveredMessages(events);
    const deltaTexts = delivered
      .filter((m: any) => m.kind === "user-prompt")
      .map((m: any) => m.text);
    expect(deltaTexts).toContain("I am new");
    expect(deltaTexts).not.toContain("I existed before the watcher");
  });

  // =========================================================================
  // Test 7: Realtime shutdown stops real watchers
  // =========================================================================

  test("sse shutdown stops real watchers and clears registry", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);
    sse = createRealSseService(pathMap);

    await connectClient(sse, sessionId);

    expect(_registry.has(sessionId)).toBe(true);

    sse.shutdown();

    expect(_registry.has(sessionId)).toBe(false);
  });
});
