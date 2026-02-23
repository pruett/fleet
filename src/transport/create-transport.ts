import type { ServerWebSocket } from "bun";
import type { ConnectedClient, Transport, TransportOptions } from "./types";
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

  // --- Relay ---

  function relayBatch(_sessionId: string, batch: WatchBatch): void {
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
      client.ws.send(frame);
    }
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

    // 2. Resolve session file path
    const filePath = await options.resolveSessionPath(sessionId);
    if (filePath === null) {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "UNKNOWN_SESSION",
          message: `Session not found: ${sessionId}`,
        }),
      );
      return;
    }

    // 3. If already subscribed to a different session, implicit unsubscribe
    if (client.sessionId !== null && client.sessionId !== sessionId) {
      handleUnsubscribe(ws);
    }

    // 4. Set client.sessionId
    client.sessionId = sessionId;

    // 5. Add to sessions inverse map
    let subscriberSet = sessions.get(sessionId);
    if (!subscriberSet) {
      subscriberSet = new Set();
      sessions.set(sessionId, subscriberSet);
    }
    subscriberSet.add(clientId);

    // 6. Start watcher for first subscriber
    if (subscriberSet.size === 1) {
      const watchHandle = options.watchSession({
        sessionId,
        filePath,
        onMessages: (batch) => relayBatch(sessionId, batch),
        onError: (err) => {
          console.error(
            `[transport] watcher error for session ${sessionId}:`,
            err.message,
          );
        },
      });
      watchers.set(sessionId, watchHandle);
    }
    // 7. If watcher already running (size > 1): no-op — fan-out happens via relayBatch
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
      ws.send(
        JSON.stringify({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Invalid JSON",
        }),
      );
      return;
    }

    // 3. Dispatch on message.type
    const msg = message as Record<string, unknown>;
    switch (msg.type) {
      case "subscribe":
        handleSubscribe(ws, msg);
        break;
      case "unsubscribe":
        handleUnsubscribe(ws);
        break;
      default:
        ws.send(
          JSON.stringify({
            type: "error",
            code: "INVALID_MESSAGE",
            message: `Unknown message type: ${String(msg.type)}`,
          }),
        );
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
    broadcastLifecycleEvent: () => {},
    getClientCount: () => clients.size,
    getSessionSubscriberCount: () => 0,
    shutdown: () => {},
  };
}
