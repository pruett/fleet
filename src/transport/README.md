# Transport Module

Real-time WebSocket transport that relays live session data to subscribed clients.

## Public Interface

### Functions

- **`createTransport(options: TransportOptions): Transport`** — Creates a WebSocket transport instance for relaying watcher batches to clients.

### Types

- **`TransportOptions`** — Dependency injection for the transport:
  - `watchSession(options): WatchHandle` — Start tailing a session.
  - `stopWatching(handle): void` — Stop a watcher.
  - `resolveSessionPath(sessionId): Promise<string | null>` — Resolve session ID to file path.

- **`Transport`** — The transport handle:
  - `handleOpen(ws)` / `handleMessage(ws, data)` / `handleClose(ws)` — WebSocket lifecycle callbacks.
  - `broadcastLifecycleEvent(event)` — Send lifecycle event to all clients.
  - `broadcastFileChangeEvent(event)` — Send file-change event to all clients.
  - `relayLifecycleEvent(event)` — Send lifecycle event to session subscribers only.
  - `getClientCount()` / `getSessionSubscriberCount(sessionId)` — Connection stats.
  - `shutdown()` — Stop heartbeat, close watchers and connections.

- **`ConnectedClient`** — A connected WebSocket client (clientId, ws, sessionId, connectedAt).
- **`ClientRegistry`** — Dual-indexed client tracking (by client ID and by session ID).
