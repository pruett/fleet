import type { ParsedMessage } from "../parser";

// ============================================================
// Watch Options (input to watchSession)
// ============================================================

export interface WatchOptions {
  /** UUID of the session to watch. */
  sessionId: string;
  /** Absolute path to the .jsonl transcript file. */
  filePath: string;
  /** Callback invoked with each flushed batch of parsed messages. */
  onMessages: (batch: WatchBatch) => void;
  /** Callback invoked on watcher-level errors. */
  onError: (error: WatchError) => void;
  /** Trailing-edge timer delay in ms (default: 100). */
  debounceMs?: number;
  /** Max-wait ceiling in ms (default: 500). */
  maxWaitMs?: number;
}

// ============================================================
// Watch Handle (returned by watchSession, passed to stopWatching)
// ============================================================

export interface WatchHandle {
  /** Echoes the sessionId from options. */
  readonly sessionId: string;
  /** Echoes the filePath from options. */
  readonly filePath: string;
  /** Current read position in bytes (advances after each read). */
  byteOffset: number;
  /** Next line number to assign (0-based, increments for each non-blank line). */
  lineIndex: number;
  /** True after stopWatching has been called. */
  stopped: boolean;
}

// ============================================================
// Watch Batch (delivered via onMessages callback)
// ============================================================

export interface WatchBatch {
  /** Which session these messages belong to. */
  sessionId: string;
  /** Ordered by lineIndex, never empty. */
  messages: ParsedMessage[];
  /** Byte offsets covered by this batch. */
  byteRange: {
    start: number;
    end: number;
  };
}

// ============================================================
// Watch Error (delivered via onError callback)
// ============================================================

export interface WatchError {
  /** Which session the error occurred in. */
  sessionId: string;
  /** Error classification. */
  code: "READ_ERROR" | "PARSE_ERROR" | "WATCH_ERROR";
  /** Human-readable description. */
  message: string;
  /** Original error, if applicable. */
  cause?: Error;
}
