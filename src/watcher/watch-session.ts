import { watch, type FSWatcher } from "fs";
import { parseLine } from "../parser";
import type { WatchOptions, WatchHandle, WatchBatch } from "./types";

/** Internal state per watcher (not exposed to consumers). */
interface WatcherState {
  handle: WatchHandle;
  watcher: FSWatcher;
  options: WatchOptions;
  /** Buffered partial line from previous read (incomplete — no trailing \n). */
  lineBuffer: string;
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

  const state: WatcherState = {
    handle,
    watcher: null as unknown as FSWatcher, // assigned immediately below
    options,
    lineBuffer: "",
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

    // Prepend any buffered partial line from previous read
    const text = state.lineBuffer + newText;

    // Split on newlines; last segment may be incomplete (no trailing \n)
    const segments = text.split("\n");
    state.lineBuffer = segments.pop()!;

    const messages = [];

    for (const line of segments) {
      const parsed = parseLine(line, handle.lineIndex);
      if (parsed !== null) {
        messages.push(parsed);
        handle.lineIndex++;
      }
    }

    // Flush immediately (no debounce yet)
    if (messages.length > 0) {
      const batch: WatchBatch = {
        sessionId,
        messages,
        byteRange: { start: batchStart, end: currentSize },
      };
      onMessages(batch);
    }
  });

  state.watcher = fsWatcher;
  registry.set(sessionId, state);

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
