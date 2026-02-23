/**
 * Test helpers for transport tests.
 * Provides mock WebSocket, mock TransportOptions, and utilities.
 */

import type { ServerWebSocket } from "bun";
import type { TransportOptions } from "../types";
import type { WatchOptions, WatchHandle, WatchBatch } from "../../watcher";

// ============================================================
// Mock WebSocket
// ============================================================

export interface MockWebSocket {
  /** The mock cast as ServerWebSocket<unknown> for use with transport methods. */
  ws: ServerWebSocket<unknown>;
  /** All strings passed to ws.send(). */
  sent: string[];
  /** If ws.close() was called, the code and reason. */
  closed: { code: number; reason?: string } | null;
}

/**
 * Create a mock ServerWebSocket that records send/close calls.
 * Only the methods used by createTransport are implemented.
 */
export function createMockWebSocket(): MockWebSocket {
  const sent: string[] = [];
  let closed: { code: number; reason?: string } | null = null;

  const ws = {
    send(data: string | Buffer) {
      sent.push(typeof data === "string" ? data : data.toString());
      return sent.length;
    },
    close(code?: number, reason?: string) {
      closed = { code: code ?? 1000, reason };
    },
    // Minimal stubs for ServerWebSocket properties that may be accessed
    readyState: 1,
    data: undefined,
    remoteAddress: "127.0.0.1",
  } as unknown as ServerWebSocket<unknown>;

  return {
    ws,
    sent,
    get closed() {
      return closed;
    },
  };
}

// ============================================================
// Mock TransportOptions
// ============================================================

export interface CapturedWatch {
  /** The options passed to watchSession. */
  options: WatchOptions;
  /** The handle returned to the transport. */
  handle: WatchHandle;
}

export interface MockTransportOptions {
  /** The TransportOptions object to pass to createTransport. */
  options: TransportOptions;
  /** All watchSession calls captured in order. */
  watches: CapturedWatch[];
  /** sessionIds for which stopWatching was called. */
  stopped: string[];
  /** Override resolveSessionPath behavior. Default: returns "/mock/sessions/<id>.jsonl". */
  resolveSessionPath: (fn: (id: string) => Promise<string | null>) => void;
}

/**
 * Create mock TransportOptions that capture watchSession/stopWatching calls
 * and allow manual triggering of watcher callbacks.
 */
export function createMockTransportOptions(): MockTransportOptions {
  const watches: CapturedWatch[] = [];
  const stopped: string[] = [];
  let resolveFn: (id: string) => Promise<string | null> = async (id) =>
    `/mock/sessions/${id}.jsonl`;

  const options: TransportOptions = {
    watchSession(watchOpts: WatchOptions): WatchHandle {
      const handle: WatchHandle = {
        sessionId: watchOpts.sessionId,
        filePath: watchOpts.filePath,
        byteOffset: 0,
        lineIndex: 0,
        stopped: false,
      };
      watches.push({ options: watchOpts, handle });
      return handle;
    },
    stopWatching(handle: WatchHandle): void {
      handle.stopped = true;
      stopped.push(handle.sessionId);
    },
    resolveSessionPath: (id: string) => resolveFn(id),
  };

  return {
    options,
    watches,
    stopped,
    resolveSessionPath(fn) {
      resolveFn = fn;
    },
  };
}

// ============================================================
// Utilities
// ============================================================

/** A valid UUID v4 for use in tests. */
export const VALID_SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

/** A second valid UUID v4 for re-subscribe / multi-session tests. */
export const VALID_SESSION_ID_2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

/** Create a minimal WatchBatch for testing relay. */
export function createMockBatch(
  sessionId: string,
  messages: WatchBatch["messages"] = [],
  byteRange: WatchBatch["byteRange"] = { start: 0, end: 100 },
): WatchBatch {
  return { sessionId, messages, byteRange };
}
