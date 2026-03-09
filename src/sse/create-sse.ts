import type {
  SseClient,
  Sse,
  SseOptions,
} from "./types";
import { BROADCAST_TYPES } from "@fleet/shared";
import type { PushableEvent } from "@fleet/shared";
import type { WatchHandle } from "../watcher";

/** A lightweight client that only receives broadcast events (no session subscription). */
interface GlobalClient {
  clientId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  connectedAt: string;
}

/** UUID v4 format: 8-4-4-4-12 hex, version nibble = 4, variant bits = 8/9/a/b. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Format a Server-Sent Event. */
function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Format an SSE comment (used for keepalive). */
function sseComment(text: string): string {
  return `: ${text}\n\n`;
}

const ENCODER = new TextEncoder();

const ACTIVITY_THROTTLE_MS = 5_000;

/**
 * Create a real-time SSE service that relays session watcher
 * batches and lifecycle events to subscribed clients.
 */
export function createSse(options: SseOptions): Sse {
  // --- Internal state ---
  const clients = new Map<string, SseClient>();
  const globalClients = new Map<string, GlobalClient>();
  const sessions = new Map<string, Set<string>>();
  const watchers = new Map<string, WatchHandle>();
  const lastActivityBroadcast = new Map<string, number>();

  // --- SSE write helpers ---

  function writeTo(target: { controller: ReadableStreamDefaultController<Uint8Array> }, data: string): void {
    try {
      target.controller.enqueue(ENCODER.encode(data));
    } catch {
      // Broken pipe / closed stream — skip
    }
  }

  function sendToSession(sessionId: string, payload: string): void {
    const subscriberIds = sessions.get(sessionId);
    if (!subscriberIds || subscriberIds.size === 0) return;
    for (const clientId of subscriberIds) {
      const client = clients.get(clientId);
      if (!client) continue;
      writeTo(client, payload);
    }
  }

  // --- Heartbeat (lazy — only runs while clients are connected) ---

  const HEARTBEAT_INTERVAL_MS = 30_000;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function startHeartbeat(): void {
    if (heartbeatTimer !== null) return;
    const keepalive = sseComment("keepalive");
    heartbeatTimer = setInterval(() => {
      for (const client of clients.values()) {
        writeTo(client, keepalive);
      }
      for (const client of globalClients.values()) {
        writeTo(client, keepalive);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer === null) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // --- Push event to subscribers (and optionally broadcast) ---

  function pushEvent(event: PushableEvent): void {
    const payload = sseEvent(event.type, event);

    // Always relay to clients subscribed to this session
    sendToSession(event.sessionId, payload);

    // Broadcast started/stopped/activity to ALL clients (for sidebar cache invalidation)
    if (BROADCAST_TYPES.has(event.type)) {
      // Avoid double-delivery: only send to session clients NOT subscribed to this session
      const subscriberIds = sessions.get(event.sessionId);
      for (const client of clients.values()) {
        if (subscriberIds?.has(client.clientId)) continue;
        writeTo(client, payload);
      }
      // Always send to global clients (they have no session subscription)
      for (const client of globalClients.values()) {
        writeTo(client, payload);
      }
    }

    // Clean up throttle state when a session stops
    if (event.type === "session:stopped") {
      lastActivityBroadcast.delete(event.sessionId);
    }

    // Throttled activity broadcast: when messages arrive, synthesize session:activity
    if (event.type === "messages") {
      const now = Date.now();
      const last = lastActivityBroadcast.get(event.sessionId) ?? 0;
      if (now - last >= ACTIVITY_THROTTLE_MS) {
        lastActivityBroadcast.set(event.sessionId, now);
        const activityEvent = {
          type: "session:activity" as const,
          sessionId: event.sessionId,
          updatedAt: new Date().toISOString(),
        };
        const activityPayload = sseEvent(activityEvent.type, activityEvent);
        const subscriberIds = sessions.get(event.sessionId);
        for (const client of clients.values()) {
          if (subscriberIds?.has(client.clientId)) continue;
          writeTo(client, activityPayload);
        }
        for (const client of globalClients.values()) {
          writeTo(client, activityPayload);
        }
      }
    }
  }

  // --- Unsubscribe ---

  function unsubscribeClient(clientId: string): void {
    const client = clients.get(clientId);
    if (!client) return;

    const sessionId = client.sessionId;

    const subscriberSet = sessions.get(sessionId);
    if (subscriberSet) {
      subscriberSet.delete(clientId);

      if (subscriberSet.size === 0) {
        sessions.delete(sessionId);
        const handle = watchers.get(sessionId);
        if (handle) {
          options.stopWatching(handle);
          watchers.delete(sessionId);
        }
      }
    }
  }

  // --- SSE Stream Handler ---

  async function handleSessionStream(
    sessionId: string,
  ): Promise<Response> {
    // 1. Validate sessionId format (UUID v4)
    if (!UUID_V4_RE.test(sessionId)) {
      return new Response(
        JSON.stringify({
          error: "Invalid sessionId format",
          code: "INVALID_SESSION_ID",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2. Resolve session file path
    const filePath = await options.resolveSessionPath(sessionId);
    if (filePath === null) {
      return new Response(
        JSON.stringify({
          error: `Session not found: ${sessionId}`,
          code: "UNKNOWN_SESSION",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // 3. Read the file, parse the snapshot, and capture byte offset
    const file = Bun.file(filePath);
    const content = await file.text();
    const byteOffset = Buffer.byteLength(content, "utf-8");
    const session = options.parseSession(content);
    // 4. Create SSE stream — send snapshot first, then stream deltas
    const clientId = crypto.randomUUID();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Register client
        const client: SseClient = {
          clientId,
          controller,
          sessionId,
          connectedAt: new Date().toISOString(),
        };
        clients.set(clientId, client);

        // Add to session subscribers
        let subscriberSet = sessions.get(sessionId);
        if (!subscriberSet) {
          subscriberSet = new Set();
          sessions.set(sessionId, subscriberSet);
        }
        subscriberSet.add(clientId);

        // Start heartbeat if first client
        startHeartbeat();

        // Send the full session snapshot as the first event
        controller.enqueue(
          ENCODER.encode(
            sseEvent("snapshot", { type: "snapshot", session }),
          ),
        );

        // Start watcher from the byte offset where the snapshot ended
        if (subscriberSet.size === 1) {
          try {
            const watchHandle = options.watchSession({
              sessionId,
              filePath,
              byteOffset,
              onMessages: (batch) => {
                pushEvent({
                  type: "messages",
                  sessionId: batch.sessionId,
                  messages: batch.messages,
                  byteRange: batch.byteRange,
                });
              },
              onError: (err) => {
                console.error(
                  `[sse] watcher error for session ${sessionId}:`,
                  err.message,
                );
              },
            });

            // Handle both sync and async watchSession
            if (watchHandle instanceof Promise) {
              watchHandle.then(
                (handle) => {
                  watchers.set(sessionId, handle);
                },
                (err) => {
                  console.error(
                    `[sse] failed to start watcher for session ${sessionId}:`,
                    err,
                  );
                },
              );
            } else {
              watchers.set(sessionId, watchHandle);
            }
          } catch {
            // Revert subscription state — this was the first (and only) subscriber
            subscriberSet.delete(clientId);
            sessions.delete(sessionId);
            clients.delete(clientId);

            // Send error event and close
            const errorData = sseEvent("error", {
              type: "error",
              code: "WATCH_FAILED",
              message: `Failed to watch session: ${sessionId}`,
            });
            controller.enqueue(ENCODER.encode(errorData));
            controller.close();
            return;
          }
        }
      },
      cancel() {
        // Client disconnected
        unsubscribeClient(clientId);
        clients.delete(clientId);
        if (clients.size === 0 && globalClients.size === 0) stopHeartbeat();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // --- Global SSE Stream (broadcast-only, no session subscription) ---

  function handleGlobalStream(): Response {
    const clientId = crypto.randomUUID();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        globalClients.set(clientId, {
          clientId,
          controller,
          connectedAt: new Date().toISOString(),
        });
        startHeartbeat();
      },
      cancel() {
        globalClients.delete(clientId);
        if (clients.size === 0 && globalClients.size === 0) stopHeartbeat();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  return {
    handleSessionStream,
    handleGlobalStream,
    pushEvent,
    getClientCount: () => clients.size + globalClients.size,
    getSessionSubscriberCount: (sessionId: string) =>
      sessions.get(sessionId)?.size ?? 0,
    shutdown: () => {
      stopHeartbeat();

      for (const handle of watchers.values()) {
        options.stopWatching(handle);
      }
      watchers.clear();

      for (const client of clients.values()) {
        try {
          client.controller.close();
        } catch {
          // Already closed — skip
        }
      }
      for (const client of globalClients.values()) {
        try {
          client.controller.close();
        } catch {
          // Already closed — skip
        }
      }

      clients.clear();
      globalClients.clear();
      sessions.clear();
      lastActivityBroadcast.clear();
    },
  };
}
