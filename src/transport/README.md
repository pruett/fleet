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

## WebSocket Messages

### Incoming (Client → Server)

#### `subscribe`

Subscribe to a session's live transcript stream.

```jsonc
{
  "type": "subscribe",
  "sessionId": "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",  // UUID v4 required
  "byteOffset": 0  // optional: resume from byte position
}
```

- Validates `sessionId` against UUID v4 format.
- Idempotent: subscribing to the already-subscribed session is a no-op.
- Implicit unsubscribe: subscribing to a different session auto-unsubscribes from the previous one.
- Starts a file watcher on first subscriber; subsequent subscribers share the existing watcher.

#### `unsubscribe`

Stop receiving messages for the current session.

```jsonc
{
  "type": "unsubscribe"
}
```

- Removes the client from the session's subscriber set.
- Stops the file watcher if this was the last subscriber.

---

### Outgoing (Server → Client)

#### `messages` — Session transcript data

Relayed from the file watcher. **Sent only to clients subscribed to the session.**

```jsonc
{
  "type": "messages",
  "sessionId": "...",
  "messages": [ /* ParsedMessage[] */ ],
  "byteRange": { "start": 0, "end": 4096 }
}
```

The `messages` array contains a discriminated union of 12 parsed message kinds:

| Kind | Category | Description |
|------|----------|-------------|
| `file-history-snapshot` | Metadata | Tracked file backups at a point in time |
| `user-prompt` | User | User's text input |
| `user-tool-result` | User | Tool execution results |
| `assistant-block` | Assistant | Content block from Claude (text, thinking, or tool_use) |
| `system-turn-duration` | System | Time elapsed in a turn |
| `system-api-error` | System | API error with retry metadata |
| `system-local-command` | System | Local command executed |
| `progress-agent` | Progress | Subagent execution progress |
| `progress-bash` | Progress | Bash command output progress |
| `progress-hook` | Progress | Hook execution progress |
| `queue-operation` | Metadata | Queue state changes |
| `malformed` | Metadata | Unparseable lines (raw + error) |

#### `heartbeat` — Keep-alive

Broadcast to **all connected clients** every 30 seconds. Only runs while at least one client is connected.

```jsonc
{
  "type": "heartbeat"
}
```

#### `session:started` — Session lifecycle

Broadcast to **all connected clients**.

```jsonc
{
  "type": "session:started",
  "sessionId": "...",
  "projectId": "...",
  "cwd": "/path/to/project",
  "startedAt": "2026-03-04T12:00:00.000Z"
}
```

#### `session:stopped` — Session lifecycle

Broadcast to **all connected clients**.

```jsonc
{
  "type": "session:stopped",
  "sessionId": "...",
  "reason": "user" | "completed" | "errored",
  "stoppedAt": "2026-03-04T12:00:00.000Z"
}
```

#### `session:error` — Session lifecycle

Broadcast to **all connected clients**.

```jsonc
{
  "type": "session:error",
  "sessionId": "...",
  "error": "Error description",
  "occurredAt": "2026-03-04T12:00:00.000Z"
}
```

#### `session:activity` — Session lifecycle

Broadcast to **all connected clients**.

```jsonc
{
  "type": "session:activity",
  "sessionId": "...",
  "updatedAt": "2026-03-04T12:00:00.000Z"
}
```

#### `session:file-changed` — File change event

Broadcast to **all connected clients**.

```jsonc
{
  "type": "session:file-changed",
  "sessionId": "...",
  "updatedAt": "2026-03-04T12:00:00.000Z"
}
```

#### `error` — Error response

Sent to the **individual client** that triggered the error.

```jsonc
{
  "type": "error",
  "code": "INVALID_MESSAGE" | "UNKNOWN_SESSION" | "WATCH_FAILED",
  "message": "Human-readable error description"
}
```

| Code | Trigger |
|------|---------|
| `INVALID_MESSAGE` | Invalid JSON, unknown message type, or invalid sessionId format |
| `UNKNOWN_SESSION` | `resolveSessionPath` returned `null` for the given sessionId |
| `WATCH_FAILED` | File watcher failed to start for the session |

---

### Message Delivery Summary

| Message | Audience |
|---------|----------|
| `messages` | Session subscribers only |
| `heartbeat` | All connected clients |
| `session:started` | All connected clients |
| `session:stopped` | All connected clients |
| `session:error` | All connected clients |
| `session:activity` | All connected clients |
| `session:file-changed` | All connected clients |
| `error` | Individual client |

Note: `relayLifecycleEvent` also exists for sending lifecycle events to **session subscribers only** (rather than broadcasting to all clients).
