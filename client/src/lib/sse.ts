export type {
  SnapshotEvent,
  MessageBatch,
  SseError,
  ServerMessage,
  ServerEventType,
} from "@fleet/shared";

export { SERVER_EVENT_TYPES } from "@fleet/shared";

export type {
  LifecycleEvent,
  SessionStarted,
  SessionStopped,
  SessionError,
  SessionActivity,
} from "@fleet/shared";

// ============================================================
// Connection status types (client-only)
// ============================================================

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface ConnectionInfo {
  status: ConnectionStatus;
  /** Reconnect attempt count (0 when connected or on initial connect). */
  attempt: number;
}
