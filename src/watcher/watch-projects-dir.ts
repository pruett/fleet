import { existsSync, readdirSync, watch, type FSWatcher } from "fs";
import { basename } from "path";

/** UUID v4 format: 8-4-4-4-12 hex, version nibble = 4, variant bits = 8/9/a/b. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Handle returned by watchProjectsDir for stopping the watcher.
 */
export interface ProjectsDirWatcher {
  /** Stop watching all base paths and clear all pending timers. */
  stop(): void;
  /** @internal — exposed for testing only. Simulates a file change event. */
  _handleFileChange: (filename: string | null) => void;
  /** @internal — exposed for testing only. The set of known session IDs. */
  _knownSessions: ReadonlySet<string>;
}

/**
 * Options for watchProjectsDir.
 */
export interface WatchProjectsDirOptions {
  /** List of base paths to watch for session files. */
  basePaths: string[];
  /** Callback invoked when a previously unseen session file appears. */
  onNewSession: (sessionId: string) => void;
  /** Callback invoked when a known session file changes (debounced per-sessionId). */
  onSessionActivity: (sessionId: string) => void;
  /** Debounce delay in milliseconds (default: 1000). */
  debounceMs?: number;
}

/**
 * Scan base paths for existing .jsonl session files and return their session IDs.
 * Uses a synchronous recursive readdir so the known set is populated before
 * any fs.watch events can fire.
 */
function seedKnownSessions(basePaths: string[]): Set<string> {
  const known = new Set<string>();

  for (const basePath of basePaths) {
    if (!existsSync(basePath)) continue;

    try {
      const entries = readdirSync(basePath, { recursive: true });
      for (const entry of entries) {
        const file = basename(String(entry));
        if (!file.endsWith(".jsonl")) continue;
        const sessionId = file.slice(0, -6);
        if (UUID_V4_RE.test(sessionId)) {
          known.add(sessionId);
        }
      }
    } catch {
      // If readdir fails, we'll just start with an empty set for this path
    }
  }

  return known;
}

/**
 * Watch all base paths for session file changes.
 *
 * On startup, scans existing .jsonl files to seed a known-sessions set.
 * When a file change fires for a sessionId not in the set, calls onNewSession.
 * For already-known sessions, debounces and calls onSessionActivity.
 */
export function watchProjectsDir(
  options: WatchProjectsDirOptions,
): ProjectsDirWatcher {
  const { basePaths, onNewSession, onSessionActivity, debounceMs = 1000 } = options;

  const knownSessions = seedKnownSessions(basePaths);
  const watchers: FSWatcher[] = [];
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Process a file change event from fs.watch.
   */
  function handleFileChange(filename: string | null): void {
    // Skip if filename is null (can happen on some platforms)
    if (!filename) return;

    // Extract the base filename without path (since recursive:true gives relative paths)
    const file = basename(filename);

    // Skip if extension is not .jsonl
    if (!file.endsWith(".jsonl")) return;

    // Extract sessionId by removing .jsonl extension
    const sessionId = file.slice(0, -6); // Remove ".jsonl"

    // Skip if stem does not match UUID v4 format
    if (!UUID_V4_RE.test(sessionId)) return;

    // New session: fire immediately (no debounce) and add to known set
    if (!knownSessions.has(sessionId)) {
      knownSessions.add(sessionId);
      onNewSession(sessionId);
      return;
    }

    // Debounce per-sessionId: clear existing timer and set a new one
    const existing = debounceTimers.get(sessionId);
    if (existing !== undefined) clearTimeout(existing);

    debounceTimers.set(
      sessionId,
      setTimeout(() => {
        debounceTimers.delete(sessionId);
        onSessionActivity(sessionId);
      }, debounceMs),
    );
  }

  // Start watching each base path
  for (const basePath of basePaths) {
    if (!existsSync(basePath)) {
      console.warn(
        `[watch-projects-dir] Skipping non-existent base path: ${basePath}`,
      );
      continue;
    }

    try {
      const watcher = watch(basePath, { recursive: true }, (_eventType, filename) => {
        handleFileChange(filename);
      });

      watcher.on("error", (err) => {
        console.warn(
          `[watch-projects-dir] Watcher error for ${basePath}:`,
          err instanceof Error ? err.message : err,
        );
      });

      watchers.push(watcher);
    } catch (err) {
      console.warn(
        `[watch-projects-dir] Failed to watch ${basePath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Return the stop handle
  return {
    /** @internal — exposed for testing only. */
    _handleFileChange: handleFileChange,
    /** @internal — exposed for testing only. */
    _knownSessions: knownSessions,
    stop(): void {
      // Clear all pending timers
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();

      // Close all watchers
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // Ignore errors during watcher close
        }
      }
      watchers.length = 0;
    },
  };
}
