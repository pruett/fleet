import type { ServerWebSocket } from "bun";
import type { WatchOptions, WatchHandle } from "../watcher";

// ============================================================
// Connected Client (internal tracking for each WebSocket)
// ============================================================

export interface ConnectedClient {
  /** Server-assigned unique ID (UUID v4). */
  clientId: string;
  /** The underlying Bun WebSocket handle. */
  ws: ServerWebSocket<unknown>;
  /** Currently subscribed session, null if none. */
  sessionId: string | null;
  /** ISO 8601 timestamp of when the client connected. */
  connectedAt: string;
}

// ============================================================
// Client Registry (dual-indexed client tracking)
// ============================================================

export interface ClientRegistry {
  /** All connected clients, keyed by clientId. */
  clients: Map<string, ConnectedClient>;
  /** Inverse index: sessionId -> set of clientIds watching that session. */
  sessions: Map<string, Set<string>>;
}

// ============================================================
// Transport Options (dependency injection for createTransport)
// ============================================================

export interface TransportOptions {
  /** Start tailing a session transcript file. From the File Watcher module. */
  watchSession: (options: WatchOptions) => WatchHandle | Promise<WatchHandle>;
  /** Stop a single watcher. From the File Watcher module. */
  stopWatching: (handle: WatchHandle) => void;
  /** Resolve a sessionId to an absolute .jsonl file path, or null if unknown. */
  resolveSessionPath: (sessionId: string) => Promise<string | null>;
}

// ============================================================
// Transport (public interface returned by createTransport)
// ============================================================

export interface Transport {
  /** Handle a new WebSocket connection. Wired into Bun's open callback. */
  handleOpen: (ws: ServerWebSocket<unknown>) => void;
  /** Handle an incoming WebSocket message. Wired into Bun's message callback. */
  handleMessage: (ws: ServerWebSocket<unknown>, data: string | Buffer) => void;
  /** Handle a WebSocket disconnection. Wired into Bun's close callback. */
  handleClose: (ws: ServerWebSocket<unknown>) => void;
  /** Send a lifecycle event to all connected clients. */
  broadcastLifecycleEvent: (event: LifecycleEvent) => void;
  /** Number of currently connected clients. */
  getClientCount: () => number;
  /** Number of clients subscribed to a specific session. */
  getSessionSubscriberCount: (sessionId: string) => number;
  /** Disconnect all clients, stop all watchers, clear state. */
  shutdown: () => void;
}

// ============================================================
// Lifecycle Events (broadcast to all connected clients)
// ============================================================

export type LifecycleEvent =
  | SessionStarted
  | SessionStopped
  | SessionError
  | SessionActivity;

export interface SessionStarted {
  type: "session:started";
  sessionId: string;
  projectId: string;
  cwd: string;
  startedAt: string;
}

export interface SessionStopped {
  type: "session:stopped";
  sessionId: string;
  reason: "user" | "completed" | "errored";
  stoppedAt: string;
}

export interface SessionError {
  type: "session:error";
  sessionId: string;
  error: string;
  occurredAt: string;
}

export interface SessionActivity {
  type: "session:activity";
  sessionId: string;
  updatedAt: string;
}
