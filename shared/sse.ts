import type {
  ParsedMessage,
  EnrichedSession,
} from "./index.ts";

// ============================================================
// Lifecycle events (pushed by controller & project-dir watcher)
// ============================================================

export interface SessionStarted {
  type: "session:started";
  sessionId: string;
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

export interface SessionMessageSent {
  type: "session:message-sent";
  sessionId: string;
  sentAt: string;
}

export interface SessionActivity {
  type: "session:activity";
  sessionId: string;
  updatedAt: string;
}

export type LifecycleEvent =
  | SessionStarted
  | SessionStopped
  | SessionError
  | SessionMessageSent
  | SessionActivity;

// ============================================================
// Server → Client SSE message types
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

export type ServerMessage =
  | SnapshotEvent
  | MessageBatch
  | LifecycleEvent
  | SseError;

/** Events that can be pushed to connected clients via `pushEvent`. */
export type PushableEvent = MessageBatch | LifecycleEvent;

/** The discriminant values of every ServerMessage variant. */
export type ServerEventType = ServerMessage["type"];

/** Lifecycle event types that should be broadcast to ALL connected clients. */
export const BROADCAST_TYPES = new Set<PushableEvent["type"]>([
  "session:started",
  "session:stopped",
  "session:activity",
]);

/** Runtime array of all SSE event types the client listens for. */
export const SERVER_EVENT_TYPES: ServerEventType[] = [
  "snapshot",
  "messages",
  "session:started",
  "session:stopped",
  "session:error",
  "session:message-sent",
  "session:activity",
  "error",
];
