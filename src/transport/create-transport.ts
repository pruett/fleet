import type { ServerWebSocket } from "bun";
import type {
  ConnectedClient,
  LifecycleEvent,
  Transport,
  TransportOptions,
} from "./types";
import type { WatchHandle, WatchBatch } from "../watcher";

/** UUID v4 format: 8-4-4-4-12 hex, version nibble = 4, variant bits = 8/9/a/b. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Create a real-time WebSocket transport that relays session watcher
 * batches to subscribed clients.
 */
export function createTransport(options: TransportOptions): Transport {
  // --- Internal state (ClientRegistry) ---
  const clients = new Map<string, ConnectedClient>();
  const sessions = new Map<string, Set<string>>();
  const watchers = new Map<string, WatchHandle>();

  // Reverse lookup: ws reference → clientId (needed by handleMessage/handleClose)
  const wsToClientId = new Map<ServerWebSocket<unknown>, string>();

  // Per-session debounce timers for session:activity broadcasts (5s window)
  const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // --- Broadcast helper ---

  function broadcastEvent(event: LifecycleEvent): void {
    const frame = JSON.stringify(event);
    for (const client of clients.values()) {
      try {
        client.ws.send(frame);
      } catch {
        // Broken pipe / closed socket — skip and continue to next client
      }
    }
  }

  // --- Relay ---

  function relayBatch(batch: WatchBatch): void {
    const subscriberIds = sessions.get(batch.sessionId);
    if (!subscriberIds || subscriberIds.size === 0) return;

    const frame = JSON.stringify({
      type: "messages",
      sessionId: batch.sessionId,
      messages: batch.messages,
      byteRange: batch.byteRange,
    });

    for (const clientId of subscriberIds) {
      const client = clients.get(clientId);
      if (!client) continue;
      try {
        client.ws.send(frame);
      } catch {
        // Broken pipe / closed socket — skip and continue to next client
      }
    }

    // Debounced session:activity broadcast to all clients (for sidebar refresh)
    const { sessionId } = batch;
    const existing = activityTimers.get(sessionId);
    if (existing !== undefined) clearTimeout(existing);
    activityTimers.set(
      sessionId,
      setTimeout(() => {
        activityTimers.delete(sessionId);
        broadcastEvent({
          type: "session:activity",
          sessionId,
          updatedAt: new Date().toISOString(),
        });
      }, 5_000),
    );
  }

  // --- Subscribe ---

  async function handleSubscribe(
    ws: ServerWebSocket<unknown>,
    msg: { sessionId?: unknown },
  ): Promise<void> {
    const clientId = wsToClientId.get(ws);
    if (clientId === undefined) return;
    const client = clients.get(clientId);
    if (!client) return;

    const { sessionId } = msg;

    // 1. Validate sessionId format (UUID v4)
    if (typeof sessionId !== "string" || !UUID_V4_RE.test(sessionId)) {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Invalid sessionId format",
        }),
      );
      return;
    }

    // 2. Already subscribed to this session — no-op
    if (client.sessionId === sessionId) return;

    // 3. Resolve session file path
    const filePath = await options.resolveSessionPath(sessionId);
    if (filePath === null) {
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "UNKNOWN_SESSION",
            message: `Session not found: ${sessionId}`,
          }),
        );
      } catch {
        // Broken pipe / closed socket — skip
      }
      return;
    }

    // Re-validate state after async gap — client may have disconnected or already subscribed
    if (!clients.has(clientId)) return;
    if (client.sessionId === sessionId) return;

    // 4. If already subscribed to a different session, implicit unsubscribe
    if (client.sessionId !== null && client.sessionId !== sessionId) {
      handleUnsubscribe(ws);
    }

    // 5. Set client.sessionId
    client.sessionId = sessionId;

    // 6. Add to sessions inverse map
    let subscriberSet = sessions.get(sessionId);
    if (!subscriberSet) {
      subscriberSet = new Set();
      sessions.set(sessionId, subscriberSet);
    }
    subscriberSet.add(clientId);

    // 7. Start watcher for first subscriber
    if (subscriberSet.size === 1) {
      try {
        const watchHandle = options.watchSession({
          sessionId,
          filePath,
          onMessages: (batch) => relayBatch(batch),
          onError: (err) => {
            console.error(
              `[transport] watcher error for session ${sessionId}:`,
              err.message,
            );
          },
        });
        watchers.set(sessionId, watchHandle);
      } catch {
        // Revert subscription state — this was the first (and only) subscriber
        subscriberSet.delete(clientId);
        sessions.delete(sessionId);
        client.sessionId = null;

        ws.send(
          JSON.stringify({
            type: "error",
            code: "WATCH_FAILED",
            message: `Failed to watch session: ${sessionId}`,
          }),
        );
      }
    }
    // 8. If watcher already running (size > 1): no-op — fan-out happens via relayBatch
  }

  // --- Unsubscribe ---

  function handleUnsubscribe(ws: ServerWebSocket<unknown>): void {
    const clientId = wsToClientId.get(ws);
    if (clientId === undefined) return;
    const client = clients.get(clientId);
    if (!client || client.sessionId === null) return;

    const sessionId = client.sessionId;

    // 1. Remove from sessions inverse map
    const subscriberSet = sessions.get(sessionId);
    if (subscriberSet) {
      subscriberSet.delete(clientId);

      // 2. If last subscriber left, stop watcher and clean up
      if (subscriberSet.size === 0) {
        sessions.delete(sessionId);
        const handle = watchers.get(sessionId);
        if (handle) {
          options.stopWatching(handle);
          watchers.delete(sessionId);
        }
      }
    }

    // 3. Clear client subscription
    client.sessionId = null;
  }

  // --- Connection lifecycle ---

  function handleOpen(ws: ServerWebSocket<unknown>): void {
    const clientId = crypto.randomUUID();
    const client: ConnectedClient = {
      clientId,
      ws,
      sessionId: null,
      connectedAt: new Date().toISOString(),
    };
    clients.set(clientId, client);
    wsToClientId.set(ws, clientId);
  }

  function handleMessage(
    ws: ServerWebSocket<unknown>,
    data: string | Buffer,
  ): void {
    // 1. Reject binary frames
    if (typeof data !== "string") {
      ws.close(1003, "Binary frames not supported");
      return;
    }

    // 2. Parse JSON
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "INVALID_MESSAGE",
            message: "Invalid JSON",
          }),
        );
      } catch {
        // Broken pipe / closed socket — skip
      }
      return;
    }

    // 3. Dispatch on message.type
    const msg = message as Record<string, unknown>;
    switch (msg.type) {
      case "subscribe":
        handleSubscribe(ws, msg).catch((err) => {
          console.error("[transport] handleSubscribe error:", err);
        });
        break;
      case "unsubscribe":
        handleUnsubscribe(ws);
        break;
      default:
        try {
          ws.send(
            JSON.stringify({
              type: "error",
              code: "INVALID_MESSAGE",
              message: `Unknown message type: ${String(msg.type)}`,
            }),
          );
        } catch {
          // Broken pipe / closed socket — skip
        }
        break;
    }
  }

  function handleClose(ws: ServerWebSocket<unknown>): void {
    const clientId = wsToClientId.get(ws);
    if (clientId === undefined) return; // already removed or unknown

    // Clean up subscription before removing client from registry
    handleUnsubscribe(ws);

    clients.delete(clientId);
    wsToClientId.delete(ws);
  }

  return {
    handleOpen,
    handleMessage,
    handleClose,
    broadcastLifecycleEvent: broadcastEvent,
    getClientCount: () => clients.size,
    getSessionSubscriberCount: (sessionId: string) =>
      sessions.get(sessionId)?.size ?? 0,
    shutdown: () => {
      // 1. Stop all watchers
      for (const handle of watchers.values()) {
        options.stopWatching(handle);
      }
      watchers.clear();

      // 2. Cancel all pending activity timers
      for (const timer of activityTimers.values()) {
        clearTimeout(timer);
      }
      activityTimers.clear();

      // 3. Close all WebSocket connections with 1001 (Going Away)
      for (const client of clients.values()) {
        client.ws.close(1001, "Server shutting down");
      }

      // 4. Clear all internal state
      clients.clear();
      sessions.clear();
      wsToClientId.clear();
    },
  };
}
