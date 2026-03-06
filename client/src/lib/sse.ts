import type {
  ParsedMessage,
  EnrichedSession,
  SessionStarted,
  SessionStopped,
  SessionError,
  SessionActivity,
  LifecycleEvent,
} from "@fleet/shared";

// ============================================================
// Server → Client message types
// ============================================================

export interface SnapshotEvent {
  type: "snapshot";
  session: EnrichedSession;
}

export interface MessageBatch {
  type: "messages";
  sessionId: string;
  messages: ParsedMessage[];
  byteRange: { start: number; end: number };
}

export interface SseError {
  type: "error";
  code: string;
  message: string;
}

export type ServerMessage = SnapshotEvent | MessageBatch | LifecycleEvent | SseError;

/** The discriminant values of every ServerMessage variant. */
export type ServerEventType = ServerMessage["type"];

/** Runtime array of all SSE event types the client listens for. */
export const SERVER_EVENT_TYPES: ServerEventType[] = [
  "snapshot",
  "messages",
  "session:started",
  "session:stopped",
  "session:error",
  "session:activity",
  "error",
];

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
