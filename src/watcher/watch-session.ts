import type { WatchOptions, WatchHandle } from "./types";

/**
 * Module-level registry of active watchers, keyed by sessionId.
 * Prevents duplicate watchers for the same session.
 */
const registry = new Map<string, WatchHandle>();

/**
 * Start tailing a session transcript file.
 * Returns a handle for inspecting state and stopping the watcher.
 */
export function watchSession(_options: WatchOptions): WatchHandle {
  throw new Error("Not implemented");
}

/**
 * Stop a single watcher. Closes the fs listener, cancels timers,
 * performs a final flush of pending messages, and marks the handle stopped.
 * No-op if the handle is already stopped.
 */
export function stopWatching(_handle: WatchHandle): void {
  throw new Error("Not implemented");
}

/**
 * Stop all active watchers. Used during server shutdown.
 */
export function stopAll(): void {
  registry.clear();
  throw new Error("Not implemented");
}
