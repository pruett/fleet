import type { ServerWebSocket } from "bun";
import type { ConnectedClient, Transport, TransportOptions } from "./types";

/**
 * Create a real-time WebSocket transport that relays session watcher
 * batches to subscribed clients.
 */
export function createTransport(_options: TransportOptions): Transport {
  // --- Internal state (ClientRegistry) ---
  const clients = new Map<string, ConnectedClient>();
  const sessions = new Map<string, Set<string>>();

  // Reverse lookup: ws reference → clientId (needed by handleMessage/handleClose)
  const wsToClientId = new Map<ServerWebSocket<unknown>, string>();

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
    const msg = message as { type?: string };
    switch (msg.type) {
      case "subscribe":
        // TODO: implement subscribe handler (Phase 0 — Subscribe & Relay)
        break;
      case "unsubscribe":
        // TODO: implement unsubscribe handler (Phase 1)
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

    // NOTE: subscription cleanup (sessions map) is deferred to Phase 1
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
