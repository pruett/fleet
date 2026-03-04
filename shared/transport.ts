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

export type LifecycleEvent =
  | SessionStarted
  | SessionStopped
  | SessionError
  | SessionActivity;

