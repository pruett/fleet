import { describe, expect, it } from "bun:test";
import { createSse } from "../create-sse";
import type { ParsedMessage } from "@fleet/shared";
import type { WatchBatch } from "../../watcher";
import type { LifecycleEvent } from "@fleet/shared";
import {
  createMockSseOptions,
  collectSseEvents,
  flushAsync,
  VALID_SESSION_ID,
  VALID_SESSION_ID_2,
} from "./helpers";

describe("createSse — SSE stream basics", () => {
  it("returns 400 for invalid sessionId format", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    const response = await sse.handleSessionStream("not-a-uuid");

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("INVALID_SESSION_ID");
  });

  it("returns 404 when resolveSessionPath returns null", async () => {
    const mock = createMockSseOptions();
    mock.resolveSessionPath(async () => null);
    const sse = createSse(mock.options);

    const response = await sse.handleSessionStream(VALID_SESSION_ID);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("UNKNOWN_SESSION");
  });

  it("returns SSE stream response with correct headers", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    const response = await sse.handleSessionStream(VALID_SESSION_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");

    sse.shutdown();
  });

  it("registers client and starts watcher on first subscriber", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    const response = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    expect(response.status).toBe(200);
    expect(sse.getClientCount()).toBe(1);
    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID)).toBe(1);
    expect(mock.watches).toHaveLength(1);
    expect(mock.watches[0].options.sessionId).toBe(VALID_SESSION_ID);

    sse.shutdown();
  });

  it("delivers messages event to subscriber after watcher callback fires", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    const response = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    const messages: ParsedMessage[] = [
      {
        kind: "user-prompt",
        uuid: "uuid-001",
        parentUuid: null,
        sessionId: VALID_SESSION_ID,
        timestamp: "2026-02-23T10:00:00.000Z",
        text: "Hello",
        isMeta: false,
        gitBranch: null,
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

    const events = await collectSseEvents(response, 50);

    const messageEvents = events.filter((e) => e.type === "messages");
    expect(messageEvents).toHaveLength(1);

    const frame = messageEvents[0].data as Record<string, unknown>;
    expect(frame.type).toBe("messages");
    expect(frame.sessionId).toBe(VALID_SESSION_ID);
    expect((frame.messages as unknown[]).length).toBe(2);
    expect(frame.byteRange).toEqual({ start: 0, end: 256 });

    sse.shutdown();
  });

  it("does not start a second watcher when two clients subscribe to the same session", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();
    await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    expect(mock.watches).toHaveLength(1);
    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID)).toBe(2);

    sse.shutdown();
  });
});

describe("createSse — client count tracking", () => {
  it("tracks client count correctly across connect/disconnect", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    expect(sse.getClientCount()).toBe(0);

    const r1 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();
    expect(sse.getClientCount()).toBe(1);

    const r2 = await sse.handleSessionStream(VALID_SESSION_ID_2);
    await flushAsync();
    expect(sse.getClientCount()).toBe(2);

    await r1.body!.cancel();
    await flushAsync();
    expect(sse.getClientCount()).toBe(1);

    await r2.body!.cancel();
    await flushAsync();
    expect(sse.getClientCount()).toBe(0);
  });
});

describe("createSse — disconnect cleanup", () => {
  it("stops watcher when last subscriber disconnects", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    const response = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    expect(mock.watches).toHaveLength(1);
    expect(mock.stopped).toHaveLength(0);

    await response.body!.cancel();
    await flushAsync();

    expect(sse.getClientCount()).toBe(0);
    expect(mock.stopped).toHaveLength(1);
    expect(mock.stopped[0]).toBe(VALID_SESSION_ID);
    expect(mock.watches[0].handle.stopped).toBe(true);
  });

  it("does not stop watcher when other subscribers remain", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    const r1 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();
    const r2 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    expect(mock.watches).toHaveLength(1);

    await r1.body!.cancel();
    await flushAsync();

    expect(sse.getClientCount()).toBe(1);
    expect(mock.stopped).toHaveLength(0);
    expect(mock.watches[0].handle.stopped).toBe(false);

    await r2.body!.cancel();
    await flushAsync();

    expect(sse.getClientCount()).toBe(0);
    expect(mock.stopped).toHaveLength(1);
    expect(mock.stopped[0]).toBe(VALID_SESSION_ID);
  });
});

describe("createSse — pushEvent", () => {
  it("pushEvent delivers session:started to all connected clients (broadcast)", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    // Client 1: subscribed to session 1
    const r1 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    // Client 2: subscribed to session 2
    const r2 = await sse.handleSessionStream(VALID_SESSION_ID_2);
    await flushAsync();

    expect(sse.getClientCount()).toBe(2);

    const event: LifecycleEvent = {
      type: "session:started",
      sessionId: VALID_SESSION_ID,
      startedAt: "2026-02-23T12:00:00.000Z",
    };

    sse.pushEvent(event);

    const events1 = await collectSseEvents(r1, 50);
    const events2 = await collectSseEvents(r2, 50);

    const lifecycle1 = events1.filter((e) => e.type === "session:started");
    const lifecycle2 = events2.filter((e) => e.type === "session:started");

    expect(lifecycle1).toHaveLength(1);
    expect(lifecycle2).toHaveLength(1);
    expect(lifecycle1[0].data).toEqual(event);

    sse.shutdown();
  });

  it("pushEvent delivers session:stopped to all connected clients (broadcast)", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    const r1 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();
    const r2 = await sse.handleSessionStream(VALID_SESSION_ID_2);
    await flushAsync();

    const event: LifecycleEvent = {
      type: "session:stopped",
      sessionId: VALID_SESSION_ID,
      reason: "completed",
      stoppedAt: "2026-02-23T12:02:00.000Z",
    };

    sse.pushEvent(event);

    const events1 = await collectSseEvents(r1, 50);
    const events2 = await collectSseEvents(r2, 50);

    expect(events1.filter((e) => e.type === "session:stopped")).toHaveLength(1);
    expect(events2.filter((e) => e.type === "session:stopped")).toHaveLength(1);

    sse.shutdown();
  });

  it("pushEvent broadcasts session:activity to all connected clients", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    // Client 1: subscribed to VALID_SESSION_ID
    const r1 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    // Client 2: subscribed to VALID_SESSION_ID_2
    const r2 = await sse.handleSessionStream(VALID_SESSION_ID_2);
    await flushAsync();

    const event: LifecycleEvent = {
      type: "session:activity",
      sessionId: VALID_SESSION_ID,
      updatedAt: "2026-03-03T12:00:00.000Z",
    };

    sse.pushEvent(event);

    const events1 = await collectSseEvents(r1, 50);
    const events2 = await collectSseEvents(r2, 50);

    const activity1 = events1.filter((e) => e.type === "session:activity");
    const activity2 = events2.filter((e) => e.type === "session:activity");

    expect(activity1).toHaveLength(1);
    expect(activity1[0].data).toEqual(event);
    expect(activity2).toHaveLength(1);
    expect(activity2[0].data).toEqual(event);

    sse.shutdown();
  });

  it("pushEvent delivers session:error only to session subscribers (no broadcast)", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    const r1 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();
    const r2 = await sse.handleSessionStream(VALID_SESSION_ID_2);
    await flushAsync();

    const event: LifecycleEvent = {
      type: "session:error",
      sessionId: VALID_SESSION_ID,
      error: "Process exited with code 1",
      occurredAt: "2026-02-23T12:01:00.000Z",
    };

    sse.pushEvent(event);

    const events1 = await collectSseEvents(r1, 50);
    const events2 = await collectSseEvents(r2, 50);

    expect(events1.filter((e) => e.type === "session:error")).toHaveLength(1);
    expect(events2.filter((e) => e.type === "session:error")).toHaveLength(0);

    sse.shutdown();
  });

  it("pushEvent to zero clients is a no-op (does not throw)", () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    const event: LifecycleEvent = {
      type: "session:stopped",
      sessionId: VALID_SESSION_ID,
      reason: "completed",
      stoppedAt: "2026-02-23T12:05:00.000Z",
    };

    sse.pushEvent(event);
  });

  it("pushEvent does not double-deliver broadcast events to session subscribers", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    // Client subscribed to the same session the event targets
    const r1 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    const event: LifecycleEvent = {
      type: "session:started",
      sessionId: VALID_SESSION_ID,
      startedAt: "2026-02-23T12:00:00.000Z",
    };

    sse.pushEvent(event);

    const events = await collectSseEvents(r1, 50);
    const started = events.filter((e) => e.type === "session:started");

    // Should receive exactly once, not twice (relay + broadcast)
    expect(started).toHaveLength(1);

    sse.shutdown();
  });
});

describe("createSse — subscriber count", () => {
  it("getSessionSubscriberCount returns 0 for unknown session", () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);
    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID)).toBe(0);
  });

  it("getSessionSubscriberCount tracks subscribers accurately", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID)).toBe(0);

    const r1 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();
    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID)).toBe(1);

    const r2 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();
    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID)).toBe(2);

    const r3 = await sse.handleSessionStream(VALID_SESSION_ID_2);
    await flushAsync();
    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID)).toBe(2);
    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID_2)).toBe(1);

    await r1.body!.cancel();
    await flushAsync();
    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID)).toBe(1);

    await r2.body!.cancel();
    await flushAsync();
    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID)).toBe(0);

    expect(sse.getSessionSubscriberCount(VALID_SESSION_ID_2)).toBe(1);

    sse.shutdown();
  });
});

describe("createSse — shutdown", () => {
  it("shutdown stops all watchers and clears state", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();
    await sse.handleSessionStream(VALID_SESSION_ID_2);
    await flushAsync();

    expect(sse.getClientCount()).toBe(2);
    expect(mock.watches).toHaveLength(2);
    expect(mock.stopped).toHaveLength(0);

    sse.shutdown();

    expect(mock.stopped).toHaveLength(2);
    expect(mock.watches[0].handle.stopped).toBe(true);
    expect(mock.watches[1].handle.stopped).toBe(true);
    expect(sse.getClientCount()).toBe(0);
  });

  it("shutdown with no clients or watchers is a no-op", () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);

    sse.shutdown();

    expect(sse.getClientCount()).toBe(0);
    expect(mock.stopped).toHaveLength(0);
  });
});
