/**
 * End-to-end SSE data-flow test.
 *
 * Simulates a user landing on a session page:
 *   Browser → GET /api/sse/sessions/:id → Hono → createRealtime → ReadableStream
 *     → snapshot event (initial session state)
 *     → messages events (live deltas from file watcher)
 *     → lifecycle events (session:started, session:stopped, etc.)
 *
 * Exercises the full server stack (Hono app + real realtime + real watcher +
 * real parser) with no mocks except the controller and scanner.
 * The SSE stream is consumed via app.request() and verified for correct
 * EventSource-compatible framing.
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
import type { LifecycleEvent } from "@fleet/shared";
import type { AppDependencies } from "../api/types";

// ---------------------------------------------------------------------------
// SSE parsing helpers
// ---------------------------------------------------------------------------

interface SseFrame {
  event: string;
  data: unknown;
}

/**
 * Read SSE frames from a Response stream.
 * Parses the raw `event:` / `data:` text format that EventSource expects.
 */
async function readSseFrames(
  response: Response,
  durationMs = 100,
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
// Test harness
// ---------------------------------------------------------------------------

/** How long to wait for the watcher debounce to flush. */
const DEBOUNCE_WAIT = 300;

interface TestHarness {
  app: ReturnType<typeof createApp>;
  realtime: Realtime;
  /** Make a request through the Hono app. */
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Build a real Hono app wired to real realtime + watcher + parser,
 * with a path map that resolves sessionIds to temp file paths.
 */
function createTestHarness(pathMap: Map<string, string>): TestHarness {
  const realtime = createRealtime({
    watchSession,
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
    request: (path, init) =>
      app.request(`http://localhost${path}`, init),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSE data flow — end-to-end through HTTP", () => {
  let harness: TestHarness;
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    harness?.realtime.shutdown();
    stopAll();
    for (const fn of cleanups) await fn();
    cleanups.length = 0;
  });

  // =========================================================================
  // 1. Connect — correct SSE response headers
  // =========================================================================

  test("returns SSE response with correct content-type and cache headers", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");
  });

  // =========================================================================
  // 2. Snapshot — first event contains the full parsed session
  // =========================================================================

  test("first SSE event is a snapshot with the parsed session", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    // Pre-populate the session file
    const line1 = toLine(makeUserPrompt("hello") as Record<string, unknown>);
    const line2 = toLine(
      makeAssistantRecord(makeTextBlock("world")) as Record<string, unknown>,
    );
    await appendLines(temp.path, [line1, line2]);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();

    const frames = await readSseFrames(res, 100);

    // First frame must be the snapshot
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0].event).toBe("snapshot");

    const snapshot = frames[0].data as Record<string, unknown>;
    expect(snapshot.type).toBe("snapshot");

    const session = snapshot.session as Record<string, unknown>;
    expect(Array.isArray(session.messages)).toBe(true);
    expect((session.messages as unknown[]).length).toBe(2);

    const kinds = (session.messages as Array<{ kind: string }>).map(
      (m) => m.kind,
    );
    expect(kinds).toContain("user-prompt");
    expect(kinds).toContain("assistant-block");
  });

  // =========================================================================
  // 3. Live deltas — file appends produce messages events
  // =========================================================================

  test("appending JSONL after connect delivers messages events", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    // Append new lines after the client has connected
    const newLine = toLine(
      makeUserPrompt("live message") as Record<string, unknown>,
    );
    await appendLines(temp.path, [newLine]);
    await wait(DEBOUNCE_WAIT);

    const frames = await readSseFrames(res, 100);

    const messageFrames = frames.filter((f) => f.event === "messages");
    expect(messageFrames.length).toBeGreaterThanOrEqual(1);

    const batch = messageFrames[0].data as Record<string, unknown>;
    expect(batch.type).toBe("messages");
    expect(batch.sessionId).toBe(sessionId);

    const messages = batch.messages as Array<{ kind: string; text?: string }>;
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].kind).toBe("user-prompt");
    expect(messages[0].text).toBe("live message");
  });

  // =========================================================================
  // 4. Snapshot + delta — pre-existing content in snapshot, new in messages
  // =========================================================================

  test("pre-existing content arrives in snapshot, new content in messages", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    // Pre-populate
    await appendLines(temp.path, [
      toLine(makeUserPrompt("existing") as Record<string, unknown>),
    ]);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    // Append after connect
    await appendLines(temp.path, [
      toLine(makeUserPrompt("fresh") as Record<string, unknown>),
    ]);
    await wait(DEBOUNCE_WAIT);

    const frames = await readSseFrames(res, 100);

    // Snapshot has pre-existing
    const snapshot = frames.find((f) => f.event === "snapshot");
    expect(snapshot).toBeDefined();
    const snapshotMessages = (
      (snapshot!.data as Record<string, unknown>).session as Record<
        string,
        unknown
      >
    ).messages as Array<{ text?: string }>;
    const snapshotTexts = snapshotMessages.map((m) => m.text);
    expect(snapshotTexts).toContain("existing");
    expect(snapshotTexts).not.toContain("fresh");

    // Delta has new content
    const messageFrames = frames.filter((f) => f.event === "messages");
    const deltaTexts = messageFrames.flatMap(
      (f) =>
        (
          (f.data as Record<string, unknown>).messages as Array<{
            text?: string;
          }>
        ).map((m) => m.text),
    );
    expect(deltaTexts).toContain("fresh");
    expect(deltaTexts).not.toContain("existing");
  });

  // =========================================================================
  // 5. Lifecycle events — pushEvent delivers to connected SSE clients
  // =========================================================================

  test("lifecycle events are delivered to the SSE stream", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();

    const event: LifecycleEvent = {
      type: "session:started",
      sessionId,
      projectId: "proj-001",
      cwd: "/test/project",
      startedAt: new Date().toISOString(),
    };
    harness.realtime.pushEvent(event);

    const stoppedEvent: LifecycleEvent = {
      type: "session:stopped",
      sessionId,
      reason: "completed",
      stoppedAt: new Date().toISOString(),
    };
    harness.realtime.pushEvent(stoppedEvent);

    const frames = await readSseFrames(res, 100);

    const startedFrames = frames.filter(
      (f) => f.event === "session:started",
    );
    expect(startedFrames).toHaveLength(1);
    expect((startedFrames[0].data as Record<string, unknown>).sessionId).toBe(
      sessionId,
    );

    const stoppedFrames = frames.filter(
      (f) => f.event === "session:stopped",
    );
    expect(stoppedFrames).toHaveLength(1);
    expect(
      (stoppedFrames[0].data as Record<string, unknown>).reason,
    ).toBe("completed");
  });

  // =========================================================================
  // 6. Broadcast — lifecycle events reach clients on other sessions
  // =========================================================================

  test("session:started broadcasts to clients on other sessions", async () => {
    const temp1 = await createTempJsonl();
    const temp2 = await createTempJsonl();
    cleanups.push(temp1.cleanup, temp2.cleanup);

    const sessionId1 = crypto.randomUUID();
    const sessionId2 = crypto.randomUUID();
    harness = createTestHarness(
      new Map([
        [sessionId1, temp1.path],
        [sessionId2, temp2.path],
      ]),
    );

    // Client 1 watches session 1
    const res1 = await harness.request(`/api/sse/sessions/${sessionId1}`);
    await flush();

    // Client 2 watches session 2
    const res2 = await harness.request(`/api/sse/sessions/${sessionId2}`);
    await flush();

    // Push started event for session 1
    harness.realtime.pushEvent({
      type: "session:started",
      sessionId: sessionId1,
      projectId: "proj-001",
      cwd: "/test",
      startedAt: new Date().toISOString(),
    });

    const frames1 = await readSseFrames(res1, 100);
    const frames2 = await readSseFrames(res2, 100);

    // Both clients receive it
    const started1 = frames1.filter((f) => f.event === "session:started");
    const started2 = frames2.filter((f) => f.event === "session:started");
    expect(started1).toHaveLength(1);
    expect(started2).toHaveLength(1);
  });

  // =========================================================================
  // 7. Event framing — verify raw SSE text format
  // =========================================================================

  test("SSE frames use correct event:/data: format for EventSource", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    await appendLines(temp.path, [
      toLine(makeUserPrompt("framing test") as Record<string, unknown>),
    ]);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();

    // Read raw bytes instead of parsed frames
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    const deadline = Date.now() + 100;

    while (Date.now() < deadline) {
      const result = await Promise.race([
        reader.read(),
        wait(Math.max(1, deadline - Date.now())).then(() => null),
      ]);
      if (result === null || result.done) break;
      raw += decoder.decode(result.value, { stream: true });
    }
    await reader.cancel();
    reader.releaseLock();

    // Verify EventSource-compatible format:
    // Each frame must have "event: <type>\n" followed by "data: <json>\n\n"
    const frameBlocks = raw.split("\n\n").filter((b) => b.trim() && !b.startsWith(":"));
    expect(frameBlocks.length).toBeGreaterThanOrEqual(1);

    for (const block of frameBlocks) {
      const lines = block.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event: "));
      const dataLine = lines.find((l) => l.startsWith("data: "));

      expect(eventLine).toBeDefined();
      expect(dataLine).toBeDefined();

      // data must be valid JSON
      const json = dataLine!.slice(6);
      expect(() => JSON.parse(json)).not.toThrow();
    }
  });

  // =========================================================================
  // 8. Error cases — invalid session ID and unknown session
  // =========================================================================

  test("returns 400 for invalid session ID format", async () => {
    harness = createTestHarness(new Map());

    const res = await harness.request("/api/sse/sessions/not-a-uuid");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_SESSION_ID");
  });

  test("returns 404 for unknown session ID", async () => {
    harness = createTestHarness(new Map());

    const unknownId = crypto.randomUUID();
    const res = await harness.request(`/api/sse/sessions/${unknownId}`);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN_SESSION");
  });

  // =========================================================================
  // 9. Disconnect cleanup — cancelling stream stops the watcher
  // =========================================================================

  test("cancelling the SSE stream cleans up the watcher", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    expect(harness.realtime.getClientCount()).toBe(1);
    expect(harness.realtime.getSessionSubscriberCount(sessionId)).toBe(1);

    // Cancel the stream (simulates browser navigating away)
    await res.body!.cancel();
    await flush();

    expect(harness.realtime.getClientCount()).toBe(0);
    expect(harness.realtime.getSessionSubscriberCount(sessionId)).toBe(0);
  });

  // =========================================================================
  // 10. Full user journey — connect, snapshot, live deltas, lifecycle, done
  // =========================================================================

  test("full user journey: snapshot → live messages → lifecycle events", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    // Pre-populate with an existing conversation
    await appendLines(temp.path, [
      toLine(makeUserPrompt("initial prompt") as Record<string, unknown>),
      toLine(
        makeAssistantRecord(
          makeTextBlock("initial response"),
        ) as Record<string, unknown>,
      ),
    ]);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    // --- Step 1: User lands on session page (SSE connects) ---
    const res = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    // --- Step 2: Session starts working (lifecycle event) ---
    harness.realtime.pushEvent({
      type: "session:started",
      sessionId,
      projectId: "proj-001",
      cwd: "/test",
      startedAt: new Date().toISOString(),
    });

    // --- Step 3: Claude generates a response (file append → watcher) ---
    await appendLines(temp.path, [
      toLine(
        makeAssistantRecord(
          makeTextBlock("streamed response"),
        ) as Record<string, unknown>,
      ),
    ]);
    await wait(DEBOUNCE_WAIT);

    // --- Step 4: Session completes (lifecycle event) ---
    harness.realtime.pushEvent({
      type: "session:stopped",
      sessionId,
      reason: "completed",
      stoppedAt: new Date().toISOString(),
    });

    // --- Verify the full event sequence ---
    const frames = await readSseFrames(res, 100);
    const eventTypes = frames.map((f) => f.event);

    // Must start with snapshot
    expect(eventTypes[0]).toBe("snapshot");

    // Snapshot contains the pre-existing conversation
    const snapshot = frames[0].data as Record<string, unknown>;
    const snapshotSession = snapshot.session as Record<string, unknown>;
    const snapshotMessages = snapshotSession.messages as Array<{
      kind: string;
      text?: string;
    }>;
    expect(snapshotMessages).toHaveLength(2);
    expect(snapshotMessages[0].text).toBe("initial prompt");

    // session:started arrives
    expect(eventTypes).toContain("session:started");

    // Live messages arrive
    expect(eventTypes).toContain("messages");
    const messageBatches = frames.filter((f) => f.event === "messages");
    const liveMessages = messageBatches.flatMap(
      (f) =>
        (f.data as Record<string, unknown>).messages as Array<{
          kind: string;
          contentBlock?: { text: string };
        }>,
    );
    const liveTexts = liveMessages
      .filter((m) => m.kind === "assistant-block")
      .map((m) => m.contentBlock?.text);
    expect(liveTexts).toContain("streamed response");

    // session:stopped arrives
    expect(eventTypes).toContain("session:stopped");

    // Verify ordering: snapshot comes before everything else
    const snapshotIndex = eventTypes.indexOf("snapshot");
    const startedIndex = eventTypes.indexOf("session:started");
    const messagesIndex = eventTypes.indexOf("messages");
    const stoppedIndex = eventTypes.indexOf("session:stopped");

    expect(snapshotIndex).toBe(0);
    expect(startedIndex).toBeGreaterThan(snapshotIndex);
    expect(stoppedIndex).toBeGreaterThan(startedIndex);
    expect(messagesIndex).toBeGreaterThan(snapshotIndex);
  });
});

// ---------------------------------------------------------------------------
// Global SSE stream tests
// ---------------------------------------------------------------------------

describe("Global SSE stream — /api/sse/events", () => {
  let harness: TestHarness;
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    harness?.realtime.shutdown();
    stopAll();
    for (const fn of cleanups) await fn();
    cleanups.length = 0;
  });

  test("returns SSE response with correct headers", async () => {
    harness = createTestHarness(new Map());

    const res = await harness.request("/api/sse/events");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");
  });

  test("global client receives session:started broadcast", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    // Connect a global client (no session subscription)
    const globalRes = await harness.request("/api/sse/events");
    await flush();

    // Push a lifecycle event
    harness.realtime.pushEvent({
      type: "session:started",
      sessionId,
      projectId: "proj-001",
      cwd: "/test",
      startedAt: new Date().toISOString(),
    });

    const frames = await readSseFrames(globalRes, 100);
    const started = frames.filter((f) => f.event === "session:started");
    expect(started).toHaveLength(1);
    expect((started[0].data as Record<string, unknown>).sessionId).toBe(sessionId);
  });

  test("global client receives session:stopped broadcast", async () => {
    harness = createTestHarness(new Map());

    const globalRes = await harness.request("/api/sse/events");
    await flush();

    const sessionId = crypto.randomUUID();
    harness.realtime.pushEvent({
      type: "session:stopped",
      sessionId,
      reason: "completed",
      stoppedAt: new Date().toISOString(),
    });

    const frames = await readSseFrames(globalRes, 100);
    const stopped = frames.filter((f) => f.event === "session:stopped");
    expect(stopped).toHaveLength(1);
    expect((stopped[0].data as Record<string, unknown>).reason).toBe("completed");
  });

  test("global client does NOT receive session messages", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    // Connect a global client AND a session client
    const globalRes = await harness.request("/api/sse/events");
    const sessionRes = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();
    await flush();

    // Append a message (triggers watcher → messages event)
    await appendLines(temp.path, [
      toLine(makeUserPrompt("only for session client") as Record<string, unknown>),
    ]);
    await wait(300);

    const globalFrames = await readSseFrames(globalRes, 100);
    const sessionFrames = await readSseFrames(sessionRes, 100);

    // Session client gets messages
    expect(sessionFrames.some((f) => f.event === "messages")).toBe(true);

    // Global client does NOT get messages or snapshots
    expect(globalFrames.some((f) => f.event === "messages")).toBe(false);
    expect(globalFrames.some((f) => f.event === "snapshot")).toBe(false);
  });

  test("global client is counted and cleaned up on disconnect", async () => {
    harness = createTestHarness(new Map());

    const res = await harness.request("/api/sse/events");
    await flush();

    expect(harness.realtime.getClientCount()).toBe(1);

    await res.body!.cancel();
    await flush();

    expect(harness.realtime.getClientCount()).toBe(0);
  });

  test("both global and session clients receive broadcast simultaneously", async () => {
    const temp = await createTempJsonl();
    cleanups.push(temp.cleanup);

    const sessionId = crypto.randomUUID();
    harness = createTestHarness(new Map([[sessionId, temp.path]]));

    const globalRes = await harness.request("/api/sse/events");
    const sessionRes = await harness.request(`/api/sse/sessions/${sessionId}`);
    await flush();

    harness.realtime.pushEvent({
      type: "session:started",
      sessionId,
      projectId: "proj-001",
      cwd: "/test",
      startedAt: new Date().toISOString(),
    });

    const globalFrames = await readSseFrames(globalRes, 100);
    const sessionFrames = await readSseFrames(sessionRes, 100);

    expect(globalFrames.some((f) => f.event === "session:started")).toBe(true);
    expect(sessionFrames.some((f) => f.event === "session:started")).toBe(true);
  });
});
