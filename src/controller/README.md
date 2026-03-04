# Controller Module

Manages Claude CLI session processes — spawning, messaging, and lifecycle.

## Public Interface

### Functions

- **`createController(options: ControllerOptions): Controller`** — Creates a controller instance for managing CLI sessions.

### Types

- **`Controller`** — The controller handle:
  - `sendMessage(sessionId, message): Promise<ControlResult>` — Send a message to an active session.
  - `stopSession(sessionId): Promise<ControlResult>` — Stop a running session.
  - `resumeSession(sessionId): Promise<ControlResult>` — Resume a paused session.
  - `startSession(opts: StartSessionOpts): Promise<ControlResult>` — Start a new session.
  - `shutdown(): void` — Shutdown all managed processes.

- **`ControllerOptions`** — Config for creating a controller:
  - `onLifecycleEvent: (event: LifecycleEvent) => void` — Callback for session lifecycle events.
  - `spawn?: SpawnFn` — Optional process spawning override.

- **`ManagedProcess`** — A managed child process (sessionId, process, startedAt).
- **`SpawnFn`** — Function signature for spawning child processes.
