import { watch, type FSWatcher } from "fs";
import { parseLine } from "../parser";
import type { WatchOptions, WatchHandle, WatchBatch } from "./types";

/** Internal state per watcher (not exposed to consumers). */
interface WatcherState {
  handle: WatchHandle;
  watcher: FSWatcher;
  options: WatchOptions;
}

/**
 * Module-level registry of active watchers, keyed by sessionId.
 * Prevents duplicate watchers for the same session.
 */
const registry = new Map<string, WatcherState>();

/**
 * Start tailing a session transcript file.
 * Returns a handle for inspecting state and stopping the watcher.
 */
export function watchSession(options: WatchOptions): WatchHandle {
  const { sessionId, filePath, onMessages } = options;

  // Get initial file size to start tailing from end
  const initialSize = Bun.file(filePath).size;

  const handle: WatchHandle = {
    sessionId,
    filePath,
    byteOffset: initialSize,
    lineIndex: 0,
    stopped: false,
  };

  // Register fs.watch listener for file changes
  const fsWatcher = watch(filePath, async (eventType) => {
    if (handle.stopped) return;
    if (eventType !== "change") return;

    const currentSize = Bun.file(filePath).size;
    if (currentSize <= handle.byteOffset) return;

    const batchStart = handle.byteOffset;
    const newText = await Bun.file(filePath)
      .slice(handle.byteOffset, currentSize)
      .text();
    handle.byteOffset = currentSize;

    // Split on newlines and parse each complete line
    const lines = newText.split("\n");
    const messages = [];

    for (const line of lines) {
      const parsed = parseLine(line, handle.lineIndex);
      if (parsed !== null) {
        messages.push(parsed);
        handle.lineIndex++;
      }
    }

    // Flush immediately (no debounce in Phase 0)
    if (messages.length > 0) {
      const batch: WatchBatch = {
        sessionId,
        messages,
        byteRange: { start: batchStart, end: currentSize },
      };
      onMessages(batch);
    }
  });

  registry.set(sessionId, { handle, watcher: fsWatcher, options });

  return handle;
}

/**
 * Stop a single watcher. Closes the fs listener and marks the handle stopped.
 * No-op if the handle is already stopped.
 */
export function stopWatching(handle: WatchHandle): void {
  if (handle.stopped) return;

  const state = registry.get(handle.sessionId);
  if (state) {
    state.watcher.close();
    registry.delete(handle.sessionId);
  }

  handle.stopped = true;
}

/**
 * Stop all active watchers. Used during server shutdown.
 */
export function stopAll(): void {
  for (const [, state] of registry) {
    state.watcher.close();
    state.handle.stopped = true;
  }
  registry.clear();
}
