# Implementation Plan: Real-time Transport

> Source: `specs/real-time-transport.md`
> Generated: 2026-02-23

---

## Phase 0 — Tracer Bullet
> Minimal WebSocket connection that subscribes to a session and receives live watcher batches

### Types & Factory
- [x] Create `src/transport/types.ts` with `ConnectedClient`, `ClientRegistry`, `TransportOptions`, `Transport`, and `LifecycleEvent` type definitions
- [x] Create `src/transport/create-transport.ts` with `createTransport()` stub returning the `Transport` interface (all methods as no-ops)

### Connection Lifecycle (Happy Path)
- [x] Implement `handleOpen` — generate clientId (UUID v4), create `ConnectedClient`, store in `clients` map
- [x] Implement `handleClose` — remove client from `clients` map (no subscription cleanup yet)
- [x] Implement `handleMessage` — parse JSON, reject binary frames (close with 1003), dispatch on `message.type`

### Subscribe & Relay (Single Client, Single Session)
- [x] Implement subscribe handler — validate sessionId format, call `resolveSessionPath`, set `client.sessionId`, add to `sessions` inverse map, call `watchSession` for first subscriber, store `WatchHandle` in `watchers` map
- [x] Implement `relayBatch` — serialize `WatchBatch` to `{ type: "messages", sessionId, messages, byteRange }` frame, send to all subscribers of the session
- [x] Write test: connect a mock WebSocket, send subscribe message, trigger watcher callback, assert client receives the messages frame with correct shape

---

## Phase 1 — Core Subscription Logic

### Unsubscribe & Cleanup
- [x] Implement unsubscribe handler — clear `client.sessionId`, remove from `sessions` set, stop watcher when last subscriber leaves
- [x] Wire unsubscribe into `handleClose` — run unsubscribe logic before removing client from registry
- [x] Implement implicit unsubscribe on re-subscribe — if client already subscribed to different session, unsubscribe first
- [x] Write tests: unsubscribe stops watcher when last subscriber leaves; re-subscribe to different session cleans up old subscription

### Multi-Client Fan-Out
- [x] Verify `relayBatch` sends single serialized frame to all subscribers of a session (serialize once, send N times)
- [x] Write test: two clients subscribed to same session both receive the batch; second subscriber does not start a new watcher

### Lifecycle Broadcast
- [x] Implement `broadcastLifecycleEvent` — serialize event, send to every connected client regardless of subscription
- [x] Write test: broadcast reaches all connected clients (subscribed and unsubscribed)

### Shutdown
- [x] Implement `shutdown` — close all WebSocket connections with code 1001, stop all watchers, clear `clients`/`sessions`/`watchers` maps
- [x] Write test: shutdown disconnects all clients and stops all watchers

### Utility Methods
- [x] Implement `getClientCount` and `getSessionSubscriberCount`
- [x] Write tests for utility methods

---

## Phase 2 — Error Handling & Validation

### Client Message Validation
- [x] Reject binary frames — close connection with status 1003
- [x] Handle invalid JSON — send `{ type: "error", code: "INVALID_MESSAGE" }` error to client
- [x] Handle unknown message type — send `INVALID_MESSAGE` error to client
- [x] Validate sessionId is UUID v4 format on subscribe — send `INVALID_MESSAGE` error if invalid
- [x] Write tests for each invalid input scenario

### Subscribe Error Cases
- [x] Handle `resolveSessionPath` returning null — send `UNKNOWN_SESSION` error, do not modify subscription state
- [x] Handle `watchSession` throwing — send `WATCH_FAILED` error, revert subscription state (remove from `sessions` map)
- [x] Write tests: unknown session returns error; watcher failure reverts state

### Send Failures
- [x] Wrap `ws.send` in try/catch in `relayBatch` and `broadcastLifecycleEvent` — catch broken pipe, continue to next client
- [x] Write test: one client's broken connection does not prevent delivery to other clients

---

## Phase 3 — Integration & Test Helpers

### Test Helpers
- [x] Create `src/transport/__tests__/helpers.ts` with mock WebSocket factory, mock `TransportOptions` builder, and utility to simulate watcher callbacks

### Integration with API Layer
- [x] Update `src/api/types.ts` `AppDependencies` to include `transport: Transport` (or expose WebSocket upgrade handler)
- [ ] Wire `createTransport` into the Bun server's WebSocket upgrade path in `create-app.ts` or a new server entry point
- [x] Add `resolveSessionPath` adapter that wraps `resolveSessionFile` from `src/api/resolve.ts`

### Close Handler Idempotency
- [x] Ensure `handleClose` is idempotent — second call for same client is a no-op
- [x] Write test: calling handleClose twice does not throw or double-remove

### Duplicate Subscribe Idempotency
- [x] Handle subscribing to the same session twice — no-op (no duplicate watcher, no double-add to set)
- [x] Write test: duplicate subscribe does not create second watcher
