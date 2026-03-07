import type {
  ParsedMessage,
  EnrichedSession,
  LifecycleEvent,
} from "./index.ts";

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
