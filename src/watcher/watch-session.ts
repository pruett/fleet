import { watch, type FSWatcher } from "fs";
import { parseLine, type ParsedMessage } from "../parser";
import type { WatchOptions, WatchHandle, WatchBatch, WatchError } from "./types";

/** Internal state per watcher (not exposed to consumers). */
interface WatcherState {
  handle: WatchHandle;
  watcher: FSWatcher;
  options: WatchOptions;
  /** Buffered partial line from previous read (incomplete — no trailing \n). */
  lineBuffer: string;
  /** Messages accumulated since last flush. */
  pendingMessages: ParsedMessage[];
  /** Trailing-edge debounce timer (resets on each new write). */
  trailingTimer: ReturnType<typeof setTimeout> | null;
  /** Max-wait ceiling timer (fires once, does not reset). */
  maxWaitTimer: ReturnType<typeof setTimeout> | null;
  /** Byte offset at the start of the current pending batch. */
  batchStartOffset: number | null;
  /** Guard against concurrent async callbacks from fs.watch. */
  processing: boolean;
}

/**
 * Module-level registry of active watchers, keyed by sessionId.
 * Prevents duplicate watchers for the same session.
 */
const registry = new Map<string, WatcherState>();

/** @internal — exposed for testing only. */
export const _registry = registry;

/**
 * Start tailing a session transcript file.
 * Returns a handle for inspecting state and stopping the watcher.
 */
export function watchSession(options: WatchOptions): WatchHandle {
  const { sessionId, filePath } = options;

  // Return existing handle if this session is already being watched
  const existing = registry.get(sessionId);
  if (existing) return existing.handle;

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
    pendingMessages: [],
    trailingTimer: null,
    maxWaitTimer: null,
    batchStartOffset: null,
    processing: false,
  };

  // Register fs.watch listener for file changes
  const fsWatcher = watch(filePath, async (eventType) => {
    if (handle.stopped) return;
    if (eventType !== "change") return;
    if (state.processing) return;

    state.processing = true;
    try {
      // Re-check loop: keep reading until no new data is available.
      // This handles data written while a previous read was in-flight.
      while (!handle.stopped) {
        const currentSize = Bun.file(filePath).size;

        // File truncation: size shrank below our read cursor.
        // Discard any pending messages (they reference content that no longer
        // exists), reset state, and re-read from the beginning.
        if (currentSize < handle.byteOffset) {
          handle.byteOffset = 0;
          handle.lineIndex = 0;
          state.lineBuffer = "";
          state.pendingMessages = [];
          state.batchStartOffset = null;
          continue;
        }

        if (currentSize === handle.byteOffset) break;

        const readStart = handle.byteOffset;
        let newText: string;
        try {
          newText = await Bun.file(filePath)
            .slice(handle.byteOffset, currentSize)
            .text();
        } catch (err) {
          state.options.onError({
            sessionId: handle.sessionId,
            code: "READ_ERROR",
            message: `Failed to read bytes ${handle.byteOffset}-${currentSize} from ${filePath}`,
            cause: err instanceof Error ? err : new Error(String(err)),
          });
          break; // stop re-check loop; continue watching on next fs.watch event
        }
        handle.byteOffset = currentSize;

        // Prepend any buffered partial line from previous read
        const text = state.lineBuffer + newText;

        // Split on newlines; last segment may be incomplete (no trailing \n)
        const segments = text.split("\n");
        state.lineBuffer = segments.pop()!;

        for (const line of segments) {
          if (line === "") continue; // skip blank lines
          try {
            const parsed = parseLine(line, handle.lineIndex);
            if (parsed !== null) {
              state.pendingMessages.push(parsed);
              handle.lineIndex++;
            }
          } catch (err) {
            state.options.onError({
              sessionId: handle.sessionId,
              code: "PARSE_ERROR",
              message: `Failed to parse line ${handle.lineIndex}`,
              cause: err instanceof Error ? err : new Error(String(err)),
            });
            handle.lineIndex++; // skip line, advance index
          }
        }

        // Track byte offset at the start of the first pending message in this batch
        if (
          state.batchStartOffset === null &&
          state.pendingMessages.length > 0
        ) {
          state.batchStartOffset = readStart;
        }

        scheduleBatchFlush(state);
      }
    } finally {
      state.processing = false;
    }
  });

  fsWatcher.on("error", (err) => {
    state.options.onError({
      sessionId: handle.sessionId,
      code: "WATCH_ERROR",
      message: `Filesystem watcher error for ${filePath}`,
      cause: err instanceof Error ? err : new Error(String(err)),
    });
    stopWatching(handle);
  });

  state.watcher = fsWatcher;
  registry.set(sessionId, state);

  return handle;
}

/**
 * Schedule a batch flush using two-phase debounce.
 *
 * Phase 1 (trailing-edge): resets on each new write — coalesces rapid bursts.
 * Phase 2 (max-wait ceiling): fires once, does not reset — bounds worst-case latency.
 */
function scheduleBatchFlush(state: WatcherState): void {
  if (state.pendingMessages.length === 0) return;

  const { debounceMs = 100, maxWaitMs = 500 } = state.options;

  // Phase 1: trailing-edge timer — resets on each new write
  if (state.trailingTimer !== null) {
    clearTimeout(state.trailingTimer);
  }
  state.trailingTimer = setTimeout(() => flush(state), debounceMs);

  // Phase 2: max-wait ceiling — fires once, does not reset
  if (state.maxWaitTimer === null) {
    state.maxWaitTimer = setTimeout(() => flush(state), maxWaitMs);
  }
}

/** Flush pending messages to the listener. */
function flush(state: WatcherState): void {
  if (state.trailingTimer !== null) {
    clearTimeout(state.trailingTimer);
    state.trailingTimer = null;
  }
  if (state.maxWaitTimer !== null) {
    clearTimeout(state.maxWaitTimer);
    state.maxWaitTimer = null;
  }

  if (state.pendingMessages.length === 0) return;

  const batch: WatchBatch = {
    sessionId: state.handle.sessionId,
    messages: [...state.pendingMessages],
    byteRange: {
      start: state.batchStartOffset!,
      end: state.handle.byteOffset,
    },
  };

  state.pendingMessages = [];
  state.batchStartOffset = null;

  state.options.onMessages(batch);
}

/**
 * Stop a single watcher. Closes the fs listener, cancels timers,
 * performs a final flush if messages are pending, and marks the handle stopped.
 * No-op if the handle is already stopped.
 */
export function stopWatching(handle: WatchHandle): void {
  if (handle.stopped) return;

  const state = registry.get(handle.sessionId);
  if (state) {
    state.watcher.close();
    flush(state);
    registry.delete(handle.sessionId);
  }

  handle.stopped = true;
}

/**
 * Stop all active watchers. Used during server shutdown.
 */
export function stopAll(): void {
  const handles = [...registry.values()].map((s) => s.handle);
  for (const handle of handles) {
    stopWatching(handle);
  }
}
