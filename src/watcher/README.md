# Watcher Module

Tails transcript files by byte offset, debounces changes, and emits batches of parsed messages.

## Public Interface

### Functions

- **`watchSession(options: WatchOptions): Promise<WatchHandle>`** — Starts tailing a session transcript file. Returns a handle for inspection and cleanup.
- **`stopWatching(handle: WatchHandle): void`** — Stops a single watcher. No-op if already stopped.
- **`stopAll(): void`** — Stops all active watchers. Used during server shutdown.
- **`watchProjectsDir(options: WatchProjectsDirOptions): ProjectsDirWatcher`** — Watches base paths for `.jsonl` file changes and emits session activity events. Returns a handle with `stop()`.

### Types

- **`WatchOptions`** — Config for `watchSession`: sessionId, filePath, onMessages callback, onError callback, optional debounceMs/maxWaitMs/byteOffset.
- **`WatchHandle`** — Handle returned by `watchSession`: sessionId, filePath, byteOffset, lineIndex, stopped.
- **`WatchBatch`** — Batch delivered via onMessages: sessionId, messages (ParsedMessage[]), byteRange.
- **`WatchError`** — Error delivered via onError: sessionId, code (`READ_ERROR` | `PARSE_ERROR` | `WATCH_ERROR`), message, cause.
- **`ProjectsDirWatcher`** — Handle returned by `watchProjectsDir` with `stop()` method.
