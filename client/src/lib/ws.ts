import type {
  ParsedMessage,
  SessionStarted,
  SessionStopped,
  SessionError,
  SessionActivity,
  LifecycleEvent,
} from "@fleet/shared";

// ============================================================
// Server → Client message types
// ============================================================

export interface MessageBatch {
  type: "messages";
  sessionId: string;
  messages: ParsedMessage[];
  byteRange: { start: number; end: number };
}

export interface WsError {
  type: "error";
  code: string;
  message: string;
}

export interface Heartbeat {
  type: "heartbeat";
}

export type ServerMessage = MessageBatch | LifecycleEvent | WsError | Heartbeat;

// Re-export shared types used by consumers of this module
export type {
  LifecycleEvent,
  SessionStarted,
  SessionStopped,
  SessionError,
  SessionActivity,
};

// ============================================================
// Connection status types
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
