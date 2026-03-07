import type { WatchOptions, WatchHandle } from "../watcher";
import type { EnrichedSession, PushableEvent } from "@fleet/shared";

// ============================================================
// Connected SSE Client (internal tracking)
// ============================================================

export interface SseClient {
  /** Server-assigned unique ID (UUID v4). */
  clientId: string;
  /** ReadableStream controller for writing SSE events. */
  controller: ReadableStreamDefaultController<Uint8Array>;
  /** The session this client is subscribed to. */
  sessionId: string;
  /** ISO 8601 timestamp of when the client connected. */
  connectedAt: string;
}

// ============================================================
// Realtime Options (dependency injection for createRealtime)
// ============================================================

export interface RealtimeOptions {
  /** Start tailing a session transcript file. From the File Watcher module. */
  watchSession: (options: WatchOptions) => WatchHandle | Promise<WatchHandle>;
  /** Stop a single watcher. From the File Watcher module. */
  stopWatching: (handle: WatchHandle) => void;
  /** Resolve a sessionId to an absolute .jsonl file path, or null if unknown. */
  resolveSessionPath: (sessionId: string) => Promise<string | null>;
  /** Parse a raw JSONL session file into an EnrichedSession. */
  parseSession: (content: string) => EnrichedSession;
}

// ============================================================
// Realtime (public interface returned by createRealtime)
// ============================================================

export interface Realtime {
  /** Create an SSE stream for a session. Sends a snapshot event followed by live deltas. */
  handleSessionStream: (sessionId: string) => Promise<Response>;
  /** Push an event — relays to session subscribers and broadcasts started/stopped to all clients. */
  pushEvent: (event: PushableEvent) => void;
  /** Number of currently connected clients. */
  getClientCount: () => number;
  /** Number of clients subscribed to a specific session. */
  getSessionSubscriberCount: (sessionId: string) => number;
  /** Disconnect all clients, stop all watchers, clear state. */
  shutdown: () => void;
}
