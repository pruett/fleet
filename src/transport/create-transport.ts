import type { Transport, TransportOptions } from "./types";

/**
 * Create a real-time WebSocket transport that relays session watcher
 * batches to subscribed clients.
 *
 * All methods are currently stubs (no-ops) — wired up in later phases.
 */
export function createTransport(_options: TransportOptions): Transport {
  return {
    handleOpen: () => {},
    handleMessage: () => {},
    handleClose: () => {},
    broadcastLifecycleEvent: () => {},
    getClientCount: () => 0,
    getSessionSubscriberCount: () => 0,
    shutdown: () => {},
  };
}
