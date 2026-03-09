export type {
  ServerMessage,
  ServerEventType,
} from "@fleet/shared";

export { SERVER_EVENT_TYPES } from "@fleet/shared";

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
