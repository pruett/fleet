# Real-time Transport

Maintains persistent WebSocket connections with clients, relaying File Watcher batches and Session Controller lifecycle events. For the watcher it consumes, see [file-watcher.md](file-watcher.md). For the parser used by the watcher, see [transcript-parser.md](transcript-parser.md). For system context, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Where It Fits

```
+-------------------+       +-------------------+
|   File Watcher    |       | Session Controller|
| (WatchBatch)      |       | (lifecycle events) |
+---------+---------+       +---------+---------+
          |                           |
          v                           v
+---------+---------------------------+---------+
|                Real-time Transport             |
|                                                |
|  Client registry     — track connected clients |
|  Subscription mgmt   — one session per client  |
|  Watcher relay       — targeted delivery       |
|  Lifecycle broadcast  — all clients             |
|  Disconnect cleanup   — stop idle watchers      |
+-------------------------+----------------------+
                          |  WebSocket frames
                          v
+-------------------------+----------------------+
|              Client Application                 |
|  subscribe/unsubscribe commands (up)            |
|  session messages + lifecycle events (down)     |
+-------------------------------------------------+
```

## Protocol

WebSocket over the same HTTP server that hosts the API Layer. The server upgrades a single well-known path (e.g., `/ws`) to WebSocket. Uses Bun's native WebSocket support.

All frames are JSON text. Binary frames are rejected and the connection is closed with status `1003` (Unsupported Data).

### Client-to-Server Messages

```
{
  type: "subscribe",
  sessionId: string,       // UUID of the session to watch
  byteOffset: number       // file byte offset the client has data up to
}
```

Subscribes the client to live updates for a session. If the client is already subscribed to a different session, that subscription is implicitly removed first (see Subscription Model). The `byteOffset` tells the watcher where to start tailing from -- typically the file size at the time the client fetched the full session via the REST API.

```
{
  type: "unsubscribe"
}
```

Removes the client's current session subscription. If the client has no active subscription, this is a no-op.

### Server-to-Client Messages

#### Session Messages (targeted)

Delivered only to clients subscribed to the matching session.

```
{
  type: "messages",
  sessionId: string,
  messages: ParsedMessage[],       // ordered by lineIndex, never empty
  byteRange: { start: number, end: number }
}
```

Mirrors the `WatchBatch` structure from the File Watcher. The `byteRange` lets the client track its position for reconnection.

#### Lifecycle Events (broadcast)

Delivered to all connected clients regardless of subscription.

```
{
  type: "session:started",
  sessionId: string,
  projectId: string,
  cwd: string,
  startedAt: string          // ISO 8601
}
```

```
{
  type: "session:stopped",
  sessionId: string,
  reason: "user" | "completed",
  stoppedAt: string          // ISO 8601
}
```

```
{
  type: "session:error",
  sessionId: string,
  error: string,
  occurredAt: string         // ISO 8601
}
```

#### Error Messages (targeted)

Delivered to the specific client whose action caused the error.

```
{
  type: "error",
  code: "INVALID_MESSAGE" | "UNKNOWN_SESSION" | "WATCH_FAILED",
  message: string
}
```

## Data Structures

### `ConnectedClient`

```
{
  clientId:       string          // server-assigned unique ID (UUID v4)
  ws:             WebSocket       // the underlying WebSocket handle
  sessionId:      string | null   // currently subscribed session, null if none
  connectedAt:    string          // ISO 8601
}
```

Internal to the transport. Clients never see their own `ConnectedClient` record.

### `ClientRegistry`

```
{
  clients:        Map<string, ConnectedClient>        // keyed by clientId
  sessions:       Map<string, Set<string>>            // sessionId -> set of clientIds
}
```

The `sessions` map is the inverse index -- it answers "which clients are watching session X?" in O(1). Both maps are maintained in lockstep.

## Functions

```
createTransport(options: TransportOptions) -> Transport
```

Creates and returns a transport instance. Does not start listening -- the caller attaches it to a Bun HTTP server's WebSocket handler.

```
TransportOptions {
  watchSession:   (options: WatchOptions) -> WatchHandle    // from File Watcher module
  stopWatching:   (handle: WatchHandle) -> void             // from File Watcher module
  resolveSessionPath: (sessionId: string) -> string | null  // returns absolute file path or null if unknown
}
```

The transport does not import the File Watcher directly. It receives watcher functions via dependency injection, enabling testing with stubs.

### `Transport`

```
{
  handleOpen:     (ws: WebSocket) -> void
  handleMessage:  (ws: WebSocket, data: string | Buffer) -> void
  handleClose:    (ws: WebSocket) -> void
  broadcastLifecycleEvent: (event: LifecycleEvent) -> void
  getClientCount: () -> number
  getSessionSubscriberCount: (sessionId: string) -> number
  shutdown:       () -> void
}
```

`handleOpen`, `handleMessage`, and `handleClose` are wired into Bun's WebSocket handler callbacks. They are not called by application code except during testing.

`broadcastLifecycleEvent` is called by the Session Controller (via the API Layer) when a session lifecycle change occurs.

`shutdown` disconnects all clients, stops all watchers, and clears state. Used during server shutdown.

## Subscription Model

One session per client at a time. This matches the UI model where the user views one session.

### Subscribe

```
on "subscribe" message from client C with { sessionId: S, byteOffset: B }:

  1. Validate sessionId format (UUID v4). If invalid → send error, return.
  2. Resolve session file path via resolveSessionPath(S). If null → send error, return.
  3. If C is already subscribed to a different session S':
       run unsubscribe logic for C (see Unsubscribe below)
  4. Set C.sessionId = S
  5. Add C.clientId to sessions[S]
  6. If sessions[S].size === 1 (first subscriber):
       start watcher:
         watchHandle = watchSession({
           sessionId: S,
           filePath: resolvedPath,
           onMessages: (batch) -> relayBatch(S, batch),
           onError: (err) -> log(err),
           byteOffset: B,
         })
       store watchHandle in watchers[S]
  7. If sessions[S].size > 1 (watcher already running):
       no-op — watcher is already delivering to relayBatch which fans out to all subscribers
```

When the first client subscribes to a session, the transport starts a watcher. The `byteOffset` from the subscribe message is passed through so the watcher tails from where the client's full-parse data ends. Subsequent subscribers to the same session join the existing watcher stream.

**Note on byte offset divergence:** When multiple clients subscribe to the same session, they may have fetched the full session at different times and thus have different byte offsets. The watcher uses the offset from the first subscriber. Later subscribers may receive some messages they already have (from the full parse). The client is responsible for deduplicating by `lineIndex` -- messages with a `lineIndex` lower than what the client already has are discarded. This is a deliberate simplicity tradeoff: the transport remains stateless per-client, and the deduplication logic is trivial (a single integer comparison).

### Unsubscribe

```
on "unsubscribe" message (or implicit unsubscribe during re-subscribe):

  1. Let S = C.sessionId. If null → no-op, return.
  2. Set C.sessionId = null
  3. Remove C.clientId from sessions[S]
  4. If sessions[S] is now empty:
       stopWatching(watchers[S])
       delete watchers[S]
       delete sessions[S]
```

When the last subscriber leaves a session, the watcher is stopped. This prevents idle watchers consuming filesystem resources.

### Disconnect

```
on WebSocket close:

  1. Run unsubscribe logic for C (cleans up watcher if last subscriber)
  2. Remove C from clients map
```

Disconnect is identical to unsubscribe followed by deregistration. No special reconnection state is preserved.

## Message Relay

### Watcher Batch Relay

When the File Watcher flushes a batch for session S, the transport relays it to all subscribers.

```
relayBatch(sessionId: S, batch: WatchBatch):
  subscriberIds = sessions[S]
  if subscriberIds is undefined or empty:
    return                         // watcher still running but subscribers left (race window)

  frame = JSON.stringify({
    type: "messages",
    sessionId: batch.sessionId,
    messages: batch.messages,
    byteRange: batch.byteRange,
  })

  for each clientId in subscriberIds:
    client = clients[clientId]
    if client.ws.readyState === OPEN:
      client.ws.send(frame)
```

The JSON frame is serialized once and sent to all subscribers. This avoids redundant serialization when multiple clients watch the same session.

### Lifecycle Event Broadcast

```
broadcastLifecycleEvent(event: LifecycleEvent):
  frame = JSON.stringify(event)

  for each client in clients.values():
    if client.ws.readyState === OPEN:
      client.ws.send(frame)
```

Lifecycle events go to every connected client. The client uses these to update session lists, show status indicators, and trigger re-fetches -- regardless of which session the client is currently viewing.

## Connection Lifecycle

### Open

```
on WebSocket connection:
  1. Generate clientId (UUID v4)
  2. Create ConnectedClient { clientId, ws, sessionId: null, connectedAt: now() }
  3. Store in clients map
```

No handshake or authentication. This is a local desktop tool -- the WebSocket server is bound to localhost.

### Message Handling

```
on WebSocket message:
  1. If binary → close connection with 1003, return
  2. Parse JSON. If invalid → send error { type: "error", code: "INVALID_MESSAGE", ... }, return
  3. Match on message.type:
       "subscribe"   → run subscribe logic
       "unsubscribe" → run unsubscribe logic
       unknown       → send error { type: "error", code: "INVALID_MESSAGE", ... }
```

### Close

```
on WebSocket close:
  1. Run unsubscribe logic (stops watcher if last subscriber)
  2. Delete from clients map
```

The close handler must be idempotent -- Bun may invoke it even if the connection was never fully established.

### Shutdown

```
shutdown():
  1. For each client: close WebSocket with 1001 (Going Away)
  2. Clear clients map
  3. Clear sessions map
  4. Stop all watchers (via stopAll or iterating watchers map)
```

Used during server shutdown. After shutdown, the transport accepts no new connections.

## Error Handling

| Error Scenario | Detection | Response | Recovery |
|---------------|-----------|----------|----------|
| Invalid JSON from client | JSON.parse throws | Send `INVALID_MESSAGE` error to client | Connection stays open |
| Unknown message type | type field not in known set | Send `INVALID_MESSAGE` error to client | Connection stays open |
| Invalid sessionId format | UUID validation fails | Send `INVALID_MESSAGE` error to client | Connection stays open |
| Session file not found | `resolveSessionPath` returns null | Send `UNKNOWN_SESSION` error to client | Connection stays open |
| Watcher fails to start | `watchSession` throws | Send `WATCH_FAILED` error to client, revert subscription state | Connection stays open |
| Watcher emits error | `onError` callback fires | Log the error (not forwarded to clients) | Watcher continues per its own error handling |
| Client send fails | `ws.send` throws (broken pipe) | Catch and trigger close handler | Client removed from registry |
| Binary frame received | Frame type check | Close connection with 1003 | Client removed from registry |

The transport never crashes on a single client's bad behavior. Errors are isolated to the offending connection.

## Concurrency

### Single-Threaded Safety

Like the File Watcher, the transport runs on Node/Bun's single-threaded event loop. All WebSocket callbacks, watcher callbacks, and timer callbacks execute sequentially. No locks or mutexes are needed. The `clients` and `sessions` maps are never mutated concurrently.

### Watcher Callback Ordering

The File Watcher guarantees that `onMessages` callbacks for a given session are invoked sequentially (each batch completes before the next is delivered). The transport inherits this guarantee -- subscribers receive batches in order.

### Close During Relay

If a client disconnects while `relayBatch` is iterating subscribers, the `ws.send` call for that client may throw or silently fail. The relay catches per-client send errors and continues to the next subscriber. The close handler runs on the next event loop tick and cleans up the departed client.

## Concrete Example

A user opens a live session in the UI. Another user (or another tab) opens the same session.

**Step 1: Client A connects**

```
WebSocket opened
→ clientId: "aaa-111"
→ clients: { "aaa-111": { sessionId: null } }
→ sessions: {}
```

**Step 2: Client A subscribes to session "xyz-789" at byte offset 2400**

```
Client A sends: { type: "subscribe", sessionId: "xyz-789", byteOffset: 2400 }

→ resolveSessionPath("xyz-789") → "/home/user/.claude/projects/-home-user-code/xyz-789.jsonl"
→ First subscriber — start watcher at byteOffset 2400
→ clients: { "aaa-111": { sessionId: "xyz-789" } }
→ sessions: { "xyz-789": Set(["aaa-111"]) }
→ watchers: { "xyz-789": WatchHandle }
```

**Step 3: CLI writes 2 lines to the session file**

```
File Watcher detects change, reads new bytes, parses 2 messages, flushes batch:
  WatchBatch { sessionId: "xyz-789", messages: [msg1, msg2], byteRange: { start: 2400, end: 2720 } }

relayBatch("xyz-789", batch):
  subscribers = ["aaa-111"]
  serialize frame once
  send to Client A

Client A receives:
  { type: "messages", sessionId: "xyz-789", messages: [msg1, msg2], byteRange: { start: 2400, end: 2720 } }
```

**Step 4: Client B connects and subscribes to the same session at byte offset 2600**

```
WebSocket opened → clientId: "bbb-222"

Client B sends: { type: "subscribe", sessionId: "xyz-789", byteOffset: 2600 }

→ Watcher already running for "xyz-789" — no new watcher started
→ Client B may receive messages with byteRange starting at 2400 (from watcher's perspective)
→ Client B discards messages with lineIndex < what it already has from full parse
→ sessions: { "xyz-789": Set(["aaa-111", "bbb-222"]) }
```

**Step 5: Session Controller emits a lifecycle event**

```
broadcastLifecycleEvent({
  type: "session:started",
  sessionId: "new-456",
  projectId: "-home-user-code",
  cwd: "/home/user/code",
  startedAt: "2026-02-22T10:30:00Z"
})

→ Sent to Client A AND Client B (regardless of their subscription to "xyz-789")
```

**Step 6: Client A switches to a different session**

```
Client A sends: { type: "subscribe", sessionId: "new-456", byteOffset: 0 }

→ Implicit unsubscribe from "xyz-789":
    Remove "aaa-111" from sessions["xyz-789"]
    sessions["xyz-789"] = Set(["bbb-222"]) — still has a subscriber, watcher continues
→ Subscribe to "new-456":
    First subscriber — start new watcher
→ sessions: { "xyz-789": Set(["bbb-222"]), "new-456": Set(["aaa-111"]) }
```

**Step 7: Client B disconnects**

```
WebSocket close for "bbb-222":
  Unsubscribe from "xyz-789":
    Remove "bbb-222" from sessions["xyz-789"]
    sessions["xyz-789"] is now empty → stopWatching("xyz-789")
  Remove "bbb-222" from clients map

→ clients: { "aaa-111": { sessionId: "new-456" } }
→ sessions: { "new-456": Set(["aaa-111"]) }
→ watchers: { "new-456": WatchHandle }   // "xyz-789" watcher stopped
```

## Verification

1. **Subscribe delivers watcher events.** Connect a client, subscribe to a session, append JSONL lines to the session file. The client receives a `messages` frame containing the correct `ParsedMessage[]` with matching `byteRange`.

2. **Unsubscribed client receives nothing.** Connect two clients. Subscribe only Client A. Append lines. Client A receives messages; Client B receives nothing.

3. **Lifecycle broadcast reaches all clients.** Connect two clients with different subscriptions (or no subscription). Broadcast a `session:started` event. Both clients receive it.

4. **Last subscriber stops watcher.** Subscribe Client A and Client B to the same session. Disconnect Client A -- watcher continues. Disconnect Client B -- watcher stops. Verify no further `onMessages` callbacks fire for that session.

5. **Implicit unsubscribe on re-subscribe.** Client subscribes to session X, then subscribes to session Y. Client stops receiving messages for session X. If no other subscribers exist for X, its watcher stops.

6. **Disconnect cleans up.** Connect a client, subscribe to a session, then close the WebSocket. The client is removed from the registry. If it was the last subscriber, the watcher stops.

7. **Invalid messages do not crash.** Send malformed JSON, unknown message types, and binary frames. The transport responds with appropriate errors or closes the connection. Other clients are unaffected.

8. **Unknown session returns error.** Subscribe to a session ID that does not resolve to a file. The client receives an `UNKNOWN_SESSION` error. No watcher is started.

9. **Duplicate subscription is idempotent.** Subscribe to the same session twice with the same byte offset. No duplicate watcher is created. The client receives each batch exactly once.

10. **Byte offset passed to watcher.** Subscribe with `byteOffset: 1500`. The watcher starts tailing from byte 1500, not from 0 or from the current file size.

11. **Single serialization for multi-subscriber relay.** Subscribe two clients to the same session. Append lines. Verify that `JSON.stringify` is called once per batch (not once per subscriber). Both clients receive identical frames.

12. **Shutdown disconnects all.** Connect 3 clients with active subscriptions. Call `shutdown`. All WebSocket connections are closed. All watchers are stopped. The client and session maps are empty.

13. **Reconnection recovery (client-driven).** Client subscribes, receives messages up to `byteRange.end = 3000`, disconnects. Client reconnects, fetches full session via REST API (which now includes data up to byte 3200), re-subscribes with `byteOffset: 3200`. The client receives only messages from byte 3200 onward -- no gap, no duplicate of the 3000-3200 range (handled by the full parse).

14. **Close handler is idempotent.** Call the close handler twice for the same client. The second call is a no-op -- no errors, no double-removal.
