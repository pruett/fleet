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

  return {
    handleOpen,
    handleMessage: () => {},
    handleClose: () => {},
    broadcastLifecycleEvent: () => {},
    getClientCount: () => clients.size,
    getSessionSubscriberCount: () => 0,
    shutdown: () => {},
  };
}
