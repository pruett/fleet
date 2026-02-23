# File Watcher

Tails transcript files by byte offset and delivers batches of newly parsed messages to listeners. For the raw JSONL format, see [jsonl-transcript-spec.md](../docs/jsonl-transcript-spec.md). For the parser it delegates to, see [transcript-parser.md](transcript-parser.md). For system context, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Where It Fits

```
+-------------------+
|   Claude Code CLI  |
|  (appends JSONL)   |
+---------+----------+
          |  fs write
          v
+---------+-------------------------------------------+
|                    File Watcher                      |
|                                                      |
|  watchSession   — start tailing a session file       |
|  stopWatching   — stop tailing and clean up          |
|                                                      |
|  [byte offset] -> [read new bytes] -> [split lines]  |
|  -> [parseLine()] -> [batch] -> [debounce] -> flush  |
+-------------------------+----------------------------+
                          |  ParsedMessage[]
                          v
+-------------------------+----------------------------+
|              Real-time Transport                      |
|  delivers batches to subscribed clients               |
+------------------------------------------------------+
```

## Functions

```
watchSession(options: WatchOptions) -> WatchHandle
```

Starts tailing a session file. Registers an `fs.watch` listener on the file (Bun's Node-compatible `fs.watch`), initializes byte offset to the current file size via `Bun.file(path).size` (so only new content is delivered), and returns a handle for stopping and inspecting state. If the file does not exist, throws. If the file is already being watched (same `sessionId`), returns the existing handle without creating a duplicate watcher.

```
stopWatching(handle: WatchHandle) -> void
```

Tears down a single watcher. Closes the filesystem listener, cancels any pending debounce timers, flushes any buffered messages (final flush), and marks the handle as stopped. After this call, no further events are emitted for this session. Calling `stopWatching` on an already-stopped handle is a no-op.

```
stopAll() -> void
```

Tears down every active watcher. Used during server shutdown.

## Data Structures

### `WatchOptions`

```
{
  sessionId:    string          // UUID of the session to watch
  filePath:     string          // absolute path to the .jsonl file
  onMessages:   (batch: WatchBatch) -> void   // callback for each flushed batch
  onError:      (error: WatchError) -> void   // callback for watcher-level errors
  debounceMs:   number          // trailing-edge timer delay (default: 100)
  maxWaitMs:    number          // max-wait ceiling (default: 500)
}
```

### `WatchHandle`

```
{
  sessionId:    string          // echoes the option
  filePath:     string          // echoes the option
  byteOffset:   number          // current read position (updated after each read)
  lineIndex:    number          // next line number to assign (0-based, increments)
  stopped:      boolean         // true after stopWatching
}
```

`WatchHandle` is opaque to callers — they pass it to `stopWatching` but should not read or mutate internal fields.

### `WatchBatch`

```
{
  sessionId:    string            // which session these messages belong to
  messages:     ParsedMessage[]   // ordered by lineIndex, never empty
  byteRange:    { start: number, end: number }  // byte offsets covered by this batch
}
```

A batch is never empty. If a read produces only blank lines or all `null` parse results, no batch is flushed.

### `WatchError`

```
{
  sessionId:    string
  code:         "READ_ERROR" | "PARSE_ERROR" | "WATCH_ERROR"
  message:      string
  cause?:       Error
}
```

Errors are informational — the watcher continues operating after a read or parse error. A `WATCH_ERROR` (e.g., file deleted, watcher handle invalidated by the OS) is terminal and the watcher stops itself.

## Core Algorithm

### Byte-Offset Tailing

The watcher never re-reads data it has already processed. It maintains a `byteOffset` that advances monotonically.

```
on filesystem change event:
  file = Bun.file(filePath)
  currentSize = file.size
  if currentSize <= byteOffset:
    return                          // no new data (or file was truncated)

  newBytes = await file.slice(byteOffset, currentSize).text()
  byteOffset = currentSize

  processNewBytes(newBytes)
```

Reads use `Bun.file(path).slice(start, end)` for explicit byte-range access, avoiding race conditions with concurrent CLI writes. `Bun.file()` returns a lazy reference — no I/O occurs until `.slice().text()` is called.

### File Truncation

Transcript files are append-only by contract. If `currentSize < byteOffset`, the file was truncated or replaced — an abnormal condition. The watcher resets: sets `byteOffset = 0`, clears the line buffer, resets `lineIndex = 0`, and re-reads from the beginning. This makes the watcher self-healing without requiring external intervention.

### Newline Splitting and Buffering

Each JSONL line is terminated by `\n`. The CLI may write partial lines (e.g., the OS flushes mid-line), so the watcher must handle incomplete trailing data.

```
lineBuffer: string = ""           // persists across reads

processNewBytes(newBytes):
  text = lineBuffer + newBytes          // already a string from .text()
  segments = text.split("\n")

  // last segment is either "" (line was complete) or a partial line
  lineBuffer = segments.pop()

  for each segment in segments:
    if segment is blank:
      continue
    msg = parseLine(segment, lineIndex)
    lineIndex += 1
    if msg is not null:
      pendingMessages.push(msg)

  scheduleBatchFlush()
```

Key invariants:
- `lineBuffer` always holds zero or more characters that have not yet been terminated by `\n`
- Complete lines are handed to `parseLine` immediately — no waiting
- `lineIndex` increments for every non-blank line attempted, including lines that produce `MalformedRecord`
- Blank lines (empty string after split) are skipped and do not increment `lineIndex`

### Two-Phase Debounce

Messages are not flushed to the listener one at a time. A two-phase debounce batches rapid writes into a single delivery while bounding worst-case latency.

```
pendingMessages: ParsedMessage[] = []
trailingTimer:   Timer | null = null
maxWaitTimer:    Timer | null = null
batchStartOffset: number | null = null     // byte offset at first pending message

scheduleBatchFlush():
  if pendingMessages is empty:
    return

  if batchStartOffset is null:
    batchStartOffset = byteOffset before this read

  // Phase 1: trailing-edge timer — resets on each new write
  clearTimer(trailingTimer)
  trailingTimer = setTimeout(flush, debounceMs)

  // Phase 2: max-wait ceiling — fires once, does not reset
  if maxWaitTimer is null:
    maxWaitTimer = setTimeout(flush, maxWaitMs)

flush():
  clearTimer(trailingTimer)
  clearTimer(maxWaitTimer)
  trailingTimer = null
  maxWaitTimer = null

  if pendingMessages is empty:
    return

  batch = WatchBatch {
    sessionId,
    messages: [...pendingMessages],
    byteRange: { start: batchStartOffset, end: byteOffset },
  }

  pendingMessages = []
  batchStartOffset = null

  onMessages(batch)
```

**Phase 1 (trailing-edge).** Every new write resets a short timer. If the CLI pauses writing for `debounceMs` milliseconds, the timer fires and flushes. This coalesces rapid sequential writes (e.g., the CLI writing 10 lines for a multi-block response) into a single batch.

**Phase 2 (max-wait ceiling).** A long timer starts when the first message enters the pending buffer and does *not* reset. Even if writes never stop (e.g., a long streaming bash output), the buffer flushes every `maxWaitMs` milliseconds. This bounds worst-case latency.

The two timers race — whichever fires first triggers the flush. After a flush, both timers are cleared and the cycle restarts on the next incoming message.

### Timer Defaults

| Parameter | Default | Rationale |
|-----------|---------|-----------|
| `debounceMs` | 100 ms | Coalesces the typical multi-line burst from a single API response (~10 lines written in <50 ms) into one batch |
| `maxWaitMs` | 500 ms | Ensures the UI updates at least twice per second during sustained writes (long bash output, streaming) |

These are configurable per-watcher via `WatchOptions` for testing (set both to 0 for synchronous flush).

## Lifecycle

### Startup Sequence

```
1. Bun.file(filePath).size → get initial size
2. Set byteOffset = initial size
3. Set lineIndex = 0
4. Register fs.watch listener
5. Return WatchHandle
```

The watcher starts at the *end* of the file. It does not read existing content — that is the API Layer's responsibility via `parseFullSession`. This prevents duplicate data: the client receives the full session from the API, then only incremental updates from the watcher.

### Shutdown Sequence

```
1. Close fs.watch listener (no more change events)
2. Cancel trailingTimer and maxWaitTimer
3. If pendingMessages is non-empty, execute one final flush
4. Set handle.stopped = true
```

The final flush ensures no messages are silently dropped. After shutdown, the `onMessages` callback is never invoked again.

### Error Recovery

| Error | Behavior |
|-------|----------|
| `Bun.file().slice().text()` fails (ENOENT, EIO) | Emit `WatchError` with `code: "READ_ERROR"`, continue watching |
| `parseLine` throws unexpectedly | Emit `WatchError` with `code: "PARSE_ERROR"`, skip line, continue |
| `fs.watch` emits error or closes | Emit `WatchError` with `code: "WATCH_ERROR"`, auto-stop this watcher |
| File truncated (`size < offset`) | Reset to byte 0, re-read from beginning (see File Truncation) |

The watcher is resilient to transient errors. Only a terminal watcher error (lost OS handle) stops it automatically.

## Concurrency

### Multiple Watchers

The watcher module maintains an internal registry keyed by `sessionId`. Calling `watchSession` with a `sessionId` that is already active returns the existing handle. This prevents duplicate watchers (and duplicate message deliveries) when multiple clients subscribe to the same session through the real-time transport.

The real-time transport manages the mapping between client subscriptions and watchers:

```
client subscribes to session X:
  if no watcher for X:
    handle = watchSession({ sessionId: X, ..., onMessages: broadcastToSubscribers })
  add client to subscriber set for X

client unsubscribes from session X:
  remove client from subscriber set for X
  if subscriber set for X is empty:
    stopWatching(handle)
```

### Thread Safety

Bun is single-threaded. All watcher callbacks (`fs.watch` events, timer callbacks, `onMessages` invocations) execute on the event loop. No mutex or lock is needed. The byte-offset read and line-buffer mutation are safe because they never run concurrently.

## Concrete Example

A live session is in progress. The CLI has already written 3 lines (800 bytes). A client opens the session.

**Step 1: Client opens session**

The API serves `parseFullSession` on the file (all 800 bytes → 3 messages). The real-time transport starts a watcher:

```
watchSession({
  sessionId: "abc-123",
  filePath: "/home/user/.claude/projects/-home-user-code/abc-123.jsonl",
  onMessages: broadcastToSubscribers,
  onError: logError,
  debounceMs: 100,
  maxWaitMs: 500,
})

→ byteOffset = 800, lineIndex = 0, watching...
```

**Step 2: CLI writes 2 lines in rapid succession (assistant thinking + text)**

```
t=0ms:   fs.watch fires (OS coalesced both writes)
         Bun.file(path).size → 1120
         Bun.file(path).slice(800, 1120).text() → 320 new bytes
         split → 2 complete lines, no remainder
         parseLine(line, 0) → AssistantBlockMessage (thinking)
         parseLine(line, 1) → AssistantBlockMessage (text)
         pendingMessages = [thinking, text]
         scheduleBatchFlush():
           set trailingTimer = 100ms
           set maxWaitTimer = 500ms
         byteOffset = 1120

t=100ms: trailingTimer fires → flush
         batch = { sessionId: "abc-123", messages: [thinking, text], byteRange: { start: 800, end: 1120 } }
         onMessages(batch) → broadcast to client
```

**Step 3: CLI writes a partial line, then completes it**

```
t=200ms: fs.watch fires
         Bun.file(path).size → 1200
         Bun.file(path).slice(1120, 1200).text() → 80 new bytes
         split → ["{ \"type\": \"system\", ..."]   (no trailing \n)
         lineBuffer = "{ \"type\": \"system\", ..."
         no complete lines → no messages → no flush scheduled
         byteOffset = 1200

t=250ms: fs.watch fires
         Bun.file(path).size → 1240
         Bun.file(path).slice(1200, 1240).text() → 40 new bytes
         text = lineBuffer + "...durationMs: 3200 }\n"
         split → ["{ ... full line ... }", ""]
         lineBuffer = ""
         parseLine(fullLine, 2) → SystemTurnDurationMessage
         pendingMessages = [turnDuration]
         scheduleBatchFlush():
           set trailingTimer = 100ms
           set maxWaitTimer = 500ms

t=350ms: trailingTimer fires → flush
         batch = { sessionId: "abc-123", messages: [turnDuration], byteRange: { start: 1120, end: 1240 } }
```

**Step 4: Client disconnects → transport calls stopWatching**

```
stopWatching(handle):
  close fs.watch
  cancel timers
  no pending messages → no final flush
  handle.stopped = true
```

## Subagent Watching

Subagent transcripts are separate files in `{sessionId}/subagents/agent-{agentId}.jsonl`. The file watcher treats each file independently — it does not automatically discover or watch subagent files when watching a parent session.

If the client needs live subagent updates, it must explicitly request a separate watcher for the subagent file. The real-time transport manages this as a separate subscription.

## Verification

1. **Byte-accurate reads.** Append N bytes to a file with a watcher at offset 0. The watcher reads exactly N bytes and produces the correct `ParsedMessage[]`. The `byteRange` in the flushed batch spans `{ start: 0, end: N }`.

2. **Incremental consistency.** For any session file, verify that replaying all `WatchBatch.messages` arrays (from a watcher started at offset 0 with `debounceMs: 0`) produces the same `ParsedMessage[]` as calling `parseLine` on each line of the file directly. Order and `lineIndex` values must match exactly.

3. **Batch coalescing.** Append 10 lines in a tight loop (< 1 ms between writes). With default debounce settings, the watcher delivers them in 1-2 batches, not 10. Total messages across all batches equals 10.

4. **Max-wait ceiling.** Append 1 line every 50 ms for 2 seconds (40 lines). With `debounceMs: 100` and `maxWaitMs: 500`, at least 4 flushes occur (one every ~500 ms). No flush contains 0 messages.

5. **Trailing-edge quiescence.** Append 5 lines in a burst, then wait. The batch flushes after `debounceMs` (not `maxWaitMs`). Measured flush latency is within `debounceMs ± 20 ms` of the last write.

6. **Partial line buffering.** Write a line in two halves (first half without `\n`, second half with `\n`). The watcher produces no messages after the first write and exactly one message after the second. The message content spans both writes.

7. **Empty and blank lines.** Append `"\n\n"` (two blank lines). The watcher reads the bytes, increments `byteOffset`, but does not flush a batch (no messages produced). `lineIndex` does not advance.

8. **Malformed lines.** Append a line of invalid JSON. The watcher produces a `MalformedRecord` with `lineIndex` set correctly. It does not throw or stop.

9. **Stop prevents further events.** Call `stopWatching`, then append more bytes to the file. The `onMessages` callback is never invoked after stop. No timers fire.

10. **Final flush on stop.** Append a line, then immediately call `stopWatching` before the debounce timer fires. The `onMessages` callback is invoked exactly once with the pending message during the stop sequence.

11. **Duplicate watcher prevention.** Call `watchSession` twice with the same `sessionId`. The second call returns the same handle. Only one set of events is emitted per file write.

12. **File truncation recovery.** Start a watcher at offset 500. Truncate the file to 0 bytes and write new content. The watcher resets to offset 0 and delivers the new content correctly. A `lineIndex` reset occurs.

13. **Watcher error resilience.** Simulate a transient read error (e.g., permissions change then revert). The watcher emits a `WatchError` with `code: "READ_ERROR"` and continues watching. The next successful read produces correct messages.

14. **No duplicate delivery.** Over a 100-write sequence, the total number of messages across all batches equals exactly 100 (assuming 100 valid, non-blank lines). No message is delivered twice; none are lost.

15. **stopAll tears down everything.** Start 3 watchers, call `stopAll`. All three handles have `stopped: true`. No further callbacks fire for any session.
