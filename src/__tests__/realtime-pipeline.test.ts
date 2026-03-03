/**
 * Integration tests for the realtime pipeline.
 *
 * Architecture under test:
 *   CLI writes JSONL → File Watcher (fs.watch + tail) → Parser (parseLine)
 *   → Transport (relayBatch) → WebSocket Client
 *
 * These tests wire the REAL watcher and REAL transport together with:
 *   - Mock WebSockets (no network layer)
 *   - Temp JSONL files (real filesystem)
 *   - Real parser (parseLine via the watcher)
 *
 * Each test uses crypto.randomUUID() for sessionIds to avoid collisions
 * in the module-level watcher registry.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { createTransport } from "../transport/create-transport";
import {
  watchSession,
  stopWatching,
  stopAll,
  _registry,
} from "../watcher/watch-session";
import { createTempJsonl, appendLines } from "../watcher/__tests__/helpers";
import {
  createMockWebSocket,
  flushAsync,
  waitMs,
} from "../transport/__tests__/helpers";
import {
  makeUserPrompt,
  makeAssistantRecord,
  makeTextBlock,
  toLine,
} from "../parser/__tests__/helpers";
import type { Transport } from "../transport/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** How long to wait for the watcher's debounce timer (default 100ms) to flush. */
const DEBOUNCE_WAIT = 300;

/** Create a transport wired to the real watcher with a path lookup map. */
function createRealTransport(pathMap: Map<string, string>): Transport {
  return createTransport({
    watchSession,
    stopWatching,
    resolveSessionPath: async (id) => pathMap.get(id) ?? null,
  });
}

/** Connect a mock WS client to the transport. */
function connectClient(transport: Transport) {
  const mock = createMockWebSocket();
  transport.handleOpen(mock.ws);
  return mock;
}

/** Send a subscribe message and wait for the async handler to complete. */
async function subscribe(
  transport: Transport,
  mock: ReturnType<typeof createMockWebSocket>,
  sessionId: string,
  byteOffset?: number,
): Promise<void> {
  const msg: Record<string, unknown> = { type: "subscribe", sessionId };
  if (byteOffset !== undefined) msg.byteOffset = byteOffset;
  transport.handleMessage(mock.ws, JSON.stringify(msg));
  // handleSubscribe is fire-and-forget (.catch) — flush microtasks so the
  // watcher is fully started before we proceed.
  await flushAsync();
  await flushAsync();
}

/** Extract "messages" frames from a mock WS's sent buffer. */
function getMessageFrames(sent: string[]) {
  return sent
    .map((s) => JSON.parse(s))
    .filter((f: Record<string, unknown>) => f.type === "messages");
}

/** Collect all ParsedMessage objects delivered across all message frames. */
function getDeliveredMessages(sent: string[]) {
  return getMessageFrames(sent).flatMap(
    (f: Record<string, unknown>) => f.messages as unknown[],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Realtime Pipeline Integration", () => {
  let transport: Transport;
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    // 1. Shut down transport (stops watchers it tracks, closes WS connections)
    transport?.shutdown();
    // 2. Defensive: stop any lingering watchers in the global registry
    stopAll();
    // 3. Clean up temp files
    for (const fn of cleanups) await fn();
    cleanups.length = 0;
  });

  // =========================================================================
  // Test 1: Happy path — file append → watcher → transport → mock WS client
  // =========================================================================

  test("file append after subscribe is delivered to WS client", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);
    transport = createRealTransport(pathMap);

    const client = connectClient(transport);
    await subscribe(transport, client, sessionId);

    // Write messages AFTER subscribe (watcher is tailing)
    const line1 = toLine(
      makeUserPrompt("hello world") as Record<string, unknown>,
    );
    const line2 = toLine(
      makeAssistantRecord(makeTextBlock("hi there")) as Record<string, unknown>,
    );
    await appendLines(temp.path, [line1, line2]);
    await waitMs(DEBOUNCE_WAIT);

    // Client received both messages with correct types and content
    const delivered = getDeliveredMessages(client.sent);
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
    transport = createRealTransport(pathMap);

    // Two clients subscribe to the same session
    const client1 = connectClient(transport);
    const client2 = connectClient(transport);
    await subscribe(transport, client1, sessionId);
    await subscribe(transport, client2, sessionId);

    // Only one watcher in the registry
    expect(_registry.size).toBe(1);

    const line = toLine(
      makeUserPrompt("broadcast me") as Record<string, unknown>,
    );
    await appendLines(temp.path, [line]);
    await waitMs(DEBOUNCE_WAIT);

    // Both clients received the message
    const delivered1 = getDeliveredMessages(client1.sent);
    const delivered2 = getDeliveredMessages(client2.sent);
    expect(delivered1).toHaveLength(1);
    expect(delivered2).toHaveLength(1);
    expect((delivered1[0] as any).text).toBe("broadcast me");
    expect((delivered2[0] as any).text).toBe("broadcast me");
  });

  // =========================================================================
  // Test 3: Snapshot-subscription gap — messages during the window
  //
  // Scenario: client fetches a REST snapshot (T1), CLI writes messages,
  // then client subscribes via WebSocket (T2). The watcher must deliver
  // ALL messages written after the snapshot — including those written
  // before the subscribe call.
  // =========================================================================

  test("messages written between REST snapshot and subscribe are delivered", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);

    // T1: REST fetch — file is empty, snapshot returns 0 messages at byte 0
    const snapshotByteOffset = Bun.file(temp.path).size;
    expect(snapshotByteOffset).toBe(0);

    // Gap window: CLI writes 2 messages between REST fetch and subscribe
    const gapLine1 = toLine(
      makeUserPrompt("gap message 1") as Record<string, unknown>,
    );
    const gapLine2 = toLine(
      makeAssistantRecord(
        makeTextBlock("gap response 1"),
      ) as Record<string, unknown>,
    );
    await appendLines(temp.path, [gapLine1, gapLine2]);

    // T2: Client subscribes with byteOffset from snapshot — watcher should tail
    // from snapshotByteOffset (0), not from the current file size.
    transport = createRealTransport(pathMap);
    const client = connectClient(transport);
    await subscribe(transport, client, sessionId, snapshotByteOffset);

    // Post-subscribe: another message arrives
    const postLine = toLine(
      makeUserPrompt("post-subscribe message") as Record<string, unknown>,
    );
    await appendLines(temp.path, [postLine]);
    await waitMs(DEBOUNCE_WAIT);

    // All 3 messages should be delivered: 2 gap + 1 post-subscribe
    const delivered = getDeliveredMessages(client.sent);
    const userTexts = delivered
      .filter((m: any) => m.kind === "user-prompt")
      .map((m: any) => m.text);
    const assistantTexts = delivered
      .filter((m: any) => m.kind === "assistant-block")
      .map((m: any) => m.contentBlock.text);

    expect(userTexts).toContain("gap message 1");
    expect(assistantTexts).toContain("gap response 1");
    expect(userTexts).toContain("post-subscribe message");
    expect(delivered).toHaveLength(3);
  });

  // =========================================================================
  // Test 4: Gap scales — no messages lost regardless of write volume
  //
  // Even when many messages are written during the latency window between
  // REST snapshot and subscribe, every single one must be delivered.
  // =========================================================================

  test("all messages written during latency window are delivered regardless of volume", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);

    // REST fetch at T1: empty file
    expect(Bun.file(temp.path).size).toBe(0);

    // Write 10 messages during the gap window
    const GAP_COUNT = 10;
    const gapLines = Array.from({ length: GAP_COUNT }, (_, i) =>
      toLine(
        makeUserPrompt(`gap-msg-${i}`) as Record<string, unknown>,
      ),
    );
    await appendLines(temp.path, gapLines);

    // Subscribe after gap writes, starting from byte 0 (REST snapshot was empty)
    transport = createRealTransport(pathMap);
    const client = connectClient(transport);
    await subscribe(transport, client, sessionId, 0);

    // Write a sentinel after subscribe to prove the watcher is running
    const sentinel = toLine(
      makeUserPrompt("sentinel-after-subscribe") as Record<string, unknown>,
    );
    await appendLines(temp.path, [sentinel]);
    await waitMs(DEBOUNCE_WAIT);

    // Every message must be delivered: all 10 gap messages + the sentinel
    const delivered = getDeliveredMessages(client.sent);
    const texts = delivered
      .filter((m: any) => m.kind === "user-prompt")
      .map((m: any) => m.text);

    for (let i = 0; i < GAP_COUNT; i++) {
      expect(texts).toContain(`gap-msg-${i}`);
    }
    expect(texts).toContain("sentinel-after-subscribe");
    expect(delivered).toHaveLength(GAP_COUNT + 1);
  });

  // =========================================================================
  // Test 5: Watcher cleanup on disconnect
  // =========================================================================

  test("watcher stops when last subscriber disconnects", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);
    transport = createRealTransport(pathMap);

    const client = connectClient(transport);
    await subscribe(transport, client, sessionId);

    expect(_registry.has(sessionId)).toBe(true);

    transport.handleClose(client.ws);

    expect(_registry.has(sessionId)).toBe(false);
  });

  // =========================================================================
  // Test 6: Pre-existing content isolation
  // =========================================================================

  test("watcher does not deliver content that existed before subscribe", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    // Write content BEFORE the watcher starts
    const preExisting = toLine(
      makeUserPrompt("I existed before the watcher") as Record<string, unknown>,
    );
    await appendLines(temp.path, [preExisting]);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);
    transport = createRealTransport(pathMap);

    const client = connectClient(transport);
    await subscribe(transport, client, sessionId);

    // Write new content after subscribe
    const newLine = toLine(
      makeUserPrompt("I am new") as Record<string, unknown>,
    );
    await appendLines(temp.path, [newLine]);
    await waitMs(DEBOUNCE_WAIT);

    // Only the new message should be delivered
    const delivered = getDeliveredMessages(client.sent);
    const texts = delivered
      .filter((m: any) => m.kind === "user-prompt")
      .map((m: any) => m.text);
    expect(texts).toContain("I am new");
    expect(texts).not.toContain("I existed before the watcher");
  });

  // =========================================================================
  // Test 7: Transport shutdown stops real watchers
  // =========================================================================

  test("transport shutdown stops real watchers and clears registry", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    const pathMap = new Map([[sessionId, temp.path]]);
    transport = createRealTransport(pathMap);

    const client = connectClient(transport);
    await subscribe(transport, client, sessionId);

    expect(_registry.has(sessionId)).toBe(true);

    transport.shutdown();

    expect(_registry.has(sessionId)).toBe(false);

    expect(client.closed).toEqual({
      code: 1001,
      reason: "Server shutting down",
    });
  });
});
