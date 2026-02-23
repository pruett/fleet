import { describe, expect, it } from "bun:test";
import { createTransport } from "../create-transport";
import type { ParsedMessage } from "../../parser";
import type { WatchBatch } from "../../watcher";
import type { LifecycleEvent } from "../types";
import {
  createMockWebSocket,
  createMockTransportOptions,
  VALID_SESSION_ID,
  VALID_SESSION_ID_2,
} from "./helpers";

describe("createTransport — Phase 0 tracer bullet", () => {
  it("delivers messages frame to subscriber after watcher callback fires", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { ws, sent } = createMockWebSocket();

    // 1. Open connection
    transport.handleOpen(ws);
    expect(transport.getClientCount()).toBe(1);

    // 2. Send subscribe message
    transport.handleMessage(
      ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID }),
    );

    // Allow async subscribe handler to complete (resolveSessionPath is async)
    await new Promise((r) => setTimeout(r, 10));

    // 3. Verify watchSession was called with correct args
    expect(mock.watches).toHaveLength(1);
    expect(mock.watches[0].options.sessionId).toBe(VALID_SESSION_ID);
    expect(mock.watches[0].options.filePath).toBe(
      `/mock/sessions/${VALID_SESSION_ID}.jsonl`,
    );

    // 4. Simulate watcher firing a batch
    const messages: ParsedMessage[] = [
      {
        kind: "user-prompt",
        uuid: "uuid-001",
        parentUuid: null,
        sessionId: VALID_SESSION_ID,
        timestamp: "2026-02-23T10:00:00.000Z",
        text: "Hello",
        isMeta: false,
        lineIndex: 0,
      },
      {
        kind: "assistant-block",
        uuid: "uuid-002",
        parentUuid: "uuid-001",
        sessionId: VALID_SESSION_ID,
        timestamp: "2026-02-23T10:00:01.000Z",
        model: "claude-sonnet-4-20250514",
        messageId: "msg-001",
        contentBlock: { type: "text", text: "Hi there" },
        usage: { input_tokens: 10, output_tokens: 5 },
        isSynthetic: false,
        lineIndex: 1,
      },
    ];

    const batch: WatchBatch = {
      sessionId: VALID_SESSION_ID,
      messages,
      byteRange: { start: 0, end: 256 },
    };

    mock.watches[0].options.onMessages(batch);

    // 5. Assert client received the correct frame
    expect(sent).toHaveLength(1);

    const frame = JSON.parse(sent[0]);
    expect(frame.type).toBe("messages");
    expect(frame.sessionId).toBe(VALID_SESSION_ID);
    expect(frame.messages).toHaveLength(2);
    expect(frame.messages[0].kind).toBe("user-prompt");
    expect(frame.messages[0].lineIndex).toBe(0);
    expect(frame.messages[1].kind).toBe("assistant-block");
    expect(frame.messages[1].lineIndex).toBe(1);
    expect(frame.byteRange).toEqual({ start: 0, end: 256 });
  });

  it("tracks client count correctly across open/close", () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);

    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();

    expect(transport.getClientCount()).toBe(0);

    transport.handleOpen(ws1.ws);
    expect(transport.getClientCount()).toBe(1);

    transport.handleOpen(ws2.ws);
    expect(transport.getClientCount()).toBe(2);

    transport.handleClose(ws1.ws);
    expect(transport.getClientCount()).toBe(1);

    transport.handleClose(ws2.ws);
    expect(transport.getClientCount()).toBe(0);
  });

  it("rejects binary frames with close code 1003", () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const mockWs = createMockWebSocket();

    transport.handleOpen(mockWs.ws);
    transport.handleMessage(mockWs.ws, Buffer.from("binary data"));

    expect(mockWs.closed).not.toBeNull();
    expect(mockWs.closed!.code).toBe(1003);
  });

  it("sends error for invalid JSON", () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { ws, sent } = createMockWebSocket();

    transport.handleOpen(ws);
    transport.handleMessage(ws, "not valid json{{{");

    expect(sent).toHaveLength(1);
    const error = JSON.parse(sent[0]);
    expect(error.type).toBe("error");
    expect(error.code).toBe("INVALID_MESSAGE");
  });

  it("sends error for unknown message type", () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { ws, sent } = createMockWebSocket();

    transport.handleOpen(ws);
    transport.handleMessage(ws, JSON.stringify({ type: "bogus" }));

    expect(sent).toHaveLength(1);
    const error = JSON.parse(sent[0]);
    expect(error.type).toBe("error");
    expect(error.code).toBe("INVALID_MESSAGE");
    expect(error.message).toContain("bogus");
  });

  it("sends INVALID_MESSAGE for non-UUID sessionId on subscribe", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { ws, sent } = createMockWebSocket();

    transport.handleOpen(ws);
    transport.handleMessage(
      ws,
      JSON.stringify({ type: "subscribe", sessionId: "not-a-uuid" }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(sent).toHaveLength(1);
    const error = JSON.parse(sent[0]);
    expect(error.type).toBe("error");
    expect(error.code).toBe("INVALID_MESSAGE");
    expect(mock.watches).toHaveLength(0);
  });

  it("sends UNKNOWN_SESSION when resolveSessionPath returns null", async () => {
    const mock = createMockTransportOptions();
    mock.resolveSessionPath(async () => null);
    const transport = createTransport(mock.options);
    const { ws, sent } = createMockWebSocket();

    transport.handleOpen(ws);
    transport.handleMessage(
      ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(sent).toHaveLength(1);
    const error = JSON.parse(sent[0]);
    expect(error.type).toBe("error");
    expect(error.code).toBe("UNKNOWN_SESSION");
    expect(mock.watches).toHaveLength(0);
  });

  it("does not start a second watcher when two clients subscribe to the same session", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();

    transport.handleOpen(ws1.ws);
    transport.handleOpen(ws2.ws);

    const subscribeMsg = JSON.stringify({
      type: "subscribe",
      sessionId: VALID_SESSION_ID,
    });

    transport.handleMessage(ws1.ws, subscribeMsg);
    await new Promise((r) => setTimeout(r, 10));

    transport.handleMessage(ws2.ws, subscribeMsg);
    await new Promise((r) => setTimeout(r, 10));

    // Only one watcher should have been started
    expect(mock.watches).toHaveLength(1);

    // Both clients should receive the batch
    const batch: WatchBatch = {
      sessionId: VALID_SESSION_ID,
      messages: [
        {
          kind: "user-prompt",
          uuid: "uuid-001",
          parentUuid: null,
          sessionId: VALID_SESSION_ID,
          timestamp: "2026-02-23T10:00:00.000Z",
          text: "Hello",
          isMeta: false,
          lineIndex: 0,
        },
      ],
      byteRange: { start: 0, end: 50 },
    };

    mock.watches[0].options.onMessages(batch);

    expect(ws1.sent).toHaveLength(1);
    expect(ws2.sent).toHaveLength(1);

    // Both received the same serialized frame
    expect(ws1.sent[0]).toBe(ws2.sent[0]);
    const frame = JSON.parse(ws1.sent[0]);
    expect(frame.type).toBe("messages");
    expect(frame.sessionId).toBe(VALID_SESSION_ID);
  });

  it("handleClose triggers unsubscribe and stops watcher when last subscriber disconnects", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { ws } = createMockWebSocket();

    transport.handleOpen(ws);
    transport.handleMessage(
      ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(mock.watches).toHaveLength(1);
    expect(mock.stopped).toHaveLength(0);

    // Disconnect — should trigger unsubscribe and stop the watcher
    transport.handleClose(ws);

    expect(transport.getClientCount()).toBe(0);
    expect(mock.stopped).toHaveLength(1);
    expect(mock.stopped[0]).toBe(VALID_SESSION_ID);
    expect(mock.watches[0].handle.stopped).toBe(true);
  });

  it("handleClose does not stop watcher when other subscribers remain", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();

    transport.handleOpen(ws1.ws);
    transport.handleOpen(ws2.ws);

    const subscribeMsg = JSON.stringify({
      type: "subscribe",
      sessionId: VALID_SESSION_ID,
    });

    transport.handleMessage(ws1.ws, subscribeMsg);
    await new Promise((r) => setTimeout(r, 10));
    transport.handleMessage(ws2.ws, subscribeMsg);
    await new Promise((r) => setTimeout(r, 10));

    expect(mock.watches).toHaveLength(1);

    // First client disconnects — watcher should continue (ws2 still subscribed)
    transport.handleClose(ws1.ws);

    expect(transport.getClientCount()).toBe(1);
    expect(mock.stopped).toHaveLength(0);
    expect(mock.watches[0].handle.stopped).toBe(false);

    // Second client disconnects — now watcher should stop
    transport.handleClose(ws2.ws);

    expect(transport.getClientCount()).toBe(0);
    expect(mock.stopped).toHaveLength(1);
    expect(mock.stopped[0]).toBe(VALID_SESSION_ID);
  });

  it("handleClose is idempotent — second call is a no-op", () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { ws } = createMockWebSocket();

    transport.handleOpen(ws);
    expect(transport.getClientCount()).toBe(1);

    transport.handleClose(ws);
    expect(transport.getClientCount()).toBe(0);

    // Second close should not throw
    transport.handleClose(ws);
    expect(transport.getClientCount()).toBe(0);
  });

  it("re-subscribe to different session unsubscribes from old session and stops its watcher", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { ws, sent } = createMockWebSocket();

    transport.handleOpen(ws);

    // Subscribe to first session
    transport.handleMessage(
      ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(mock.watches).toHaveLength(1);
    expect(mock.watches[0].options.sessionId).toBe(VALID_SESSION_ID);

    // Re-subscribe to a different session
    transport.handleMessage(
      ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID_2 }),
    );
    await new Promise((r) => setTimeout(r, 10));

    // Old watcher should have been stopped (last subscriber left)
    expect(mock.stopped).toHaveLength(1);
    expect(mock.stopped[0]).toBe(VALID_SESSION_ID);
    expect(mock.watches[0].handle.stopped).toBe(true);

    // New watcher should have been started
    expect(mock.watches).toHaveLength(2);
    expect(mock.watches[1].options.sessionId).toBe(VALID_SESSION_ID_2);
    expect(mock.watches[1].handle.stopped).toBe(false);

    // Client should now receive batches from the new session only
    const batch = {
      sessionId: VALID_SESSION_ID_2,
      messages: [],
      byteRange: { start: 0, end: 50 },
    };
    mock.watches[1].options.onMessages(batch);

    // Filter out any error messages — only look for the relay frame
    const frames = sent.map((s) => JSON.parse(s));
    const messageFrames = frames.filter(
      (f: Record<string, unknown>) => f.type === "messages",
    );
    expect(messageFrames).toHaveLength(1);
    expect(messageFrames[0].sessionId).toBe(VALID_SESSION_ID_2);
  });

  it("re-subscribe does not unsubscribe if new session fails to resolve", async () => {
    const mock = createMockTransportOptions();
    let callCount = 0;
    mock.resolveSessionPath(async (id) => {
      callCount++;
      // First call succeeds (initial subscribe), second call fails (re-subscribe)
      if (callCount === 1) return `/mock/sessions/${id}.jsonl`;
      return null;
    });
    const transport = createTransport(mock.options);
    const { ws } = createMockWebSocket();

    transport.handleOpen(ws);

    // Subscribe to first session — should succeed
    transport.handleMessage(
      ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(mock.watches).toHaveLength(1);

    // Re-subscribe to a different session — resolve fails
    transport.handleMessage(
      ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID_2 }),
    );
    await new Promise((r) => setTimeout(r, 10));

    // Old watcher should NOT have been stopped — the client stays on the old session
    expect(mock.stopped).toHaveLength(0);
    expect(mock.watches[0].handle.stopped).toBe(false);

    // No new watcher started
    expect(mock.watches).toHaveLength(1);
  });
});

describe("createTransport — Phase 1 lifecycle broadcast", () => {
  it("broadcasts lifecycle event to all connected clients regardless of subscription", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);

    // Client 1: subscribed to a session
    const ws1 = createMockWebSocket();
    transport.handleOpen(ws1.ws);
    transport.handleMessage(
      ws1.ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID }),
    );
    await new Promise((r) => setTimeout(r, 10));

    // Client 2: connected but NOT subscribed
    const ws2 = createMockWebSocket();
    transport.handleOpen(ws2.ws);

    // Client 3: subscribed to a different session
    const ws3 = createMockWebSocket();
    transport.handleOpen(ws3.ws);
    transport.handleMessage(
      ws3.ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID_2 }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(transport.getClientCount()).toBe(3);

    // Broadcast a lifecycle event
    const event: LifecycleEvent = {
      type: "session:started",
      sessionId: VALID_SESSION_ID,
      projectId: "proj-001",
      cwd: "/mock/project",
      startedAt: "2026-02-23T12:00:00.000Z",
    };

    transport.broadcastLifecycleEvent(event);

    // All three clients should receive the event
    for (const mock of [ws1, ws2, ws3]) {
      const frames = mock.sent.map((s) => JSON.parse(s));
      const lifecycleFrames = frames.filter(
        (f: Record<string, unknown>) =>
          typeof f.type === "string" && f.type.startsWith("session:"),
      );
      expect(lifecycleFrames).toHaveLength(1);
      expect(lifecycleFrames[0]).toEqual(event);
    }

    // All three received the exact same serialized string (serialize once)
    const lifecycleFrame1 = ws1.sent[ws1.sent.length - 1];
    const lifecycleFrame2 = ws2.sent[ws2.sent.length - 1];
    const lifecycleFrame3 = ws3.sent[ws3.sent.length - 1];
    expect(lifecycleFrame1).toBe(lifecycleFrame2);
    expect(lifecycleFrame2).toBe(lifecycleFrame3);
  });

  it("broadcast to zero clients is a no-op (does not throw)", () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);

    const event: LifecycleEvent = {
      type: "session:stopped",
      sessionId: VALID_SESSION_ID,
      reason: "completed",
      stoppedAt: "2026-02-23T12:05:00.000Z",
    };

    // Should not throw
    transport.broadcastLifecycleEvent(event);
  });
});

describe("createTransport — Phase 1 shutdown", () => {
  it("shutdown closes all clients with 1001, stops all watchers, and clears state", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);

    // Connect three clients, subscribe two to different sessions
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    const ws3 = createMockWebSocket();

    transport.handleOpen(ws1.ws);
    transport.handleOpen(ws2.ws);
    transport.handleOpen(ws3.ws);

    transport.handleMessage(
      ws1.ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID }),
    );
    await new Promise((r) => setTimeout(r, 10));

    transport.handleMessage(
      ws2.ws,
      JSON.stringify({ type: "subscribe", sessionId: VALID_SESSION_ID_2 }),
    );
    await new Promise((r) => setTimeout(r, 10));

    // ws3 is connected but not subscribed
    expect(transport.getClientCount()).toBe(3);
    expect(mock.watches).toHaveLength(2);
    expect(mock.stopped).toHaveLength(0);

    // Shutdown
    transport.shutdown();

    // All watchers stopped
    expect(mock.stopped).toHaveLength(2);
    expect(mock.watches[0].handle.stopped).toBe(true);
    expect(mock.watches[1].handle.stopped).toBe(true);

    // All clients closed with 1001
    expect(ws1.closed).toEqual({ code: 1001, reason: "Server shutting down" });
    expect(ws2.closed).toEqual({ code: 1001, reason: "Server shutting down" });
    expect(ws3.closed).toEqual({ code: 1001, reason: "Server shutting down" });

    // Internal state cleared
    expect(transport.getClientCount()).toBe(0);
  });

  it("shutdown with no clients or watchers is a no-op", () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);

    // Should not throw
    transport.shutdown();

    expect(transport.getClientCount()).toBe(0);
    expect(mock.stopped).toHaveLength(0);
  });
});
