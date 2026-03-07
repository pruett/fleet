/**
 * Test helpers for realtime tests.
 * Provides mock RealtimeOptions and SSE stream utilities.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RealtimeOptions } from "../types";
import type { WatchOptions, WatchHandle, WatchBatch } from "../../watcher";
import type { EnrichedSession } from "@fleet/shared";

// ============================================================
// Mock RealtimeOptions
// ============================================================

export interface CapturedWatch {
  /** The options passed to watchSession. */
  options: WatchOptions;
  /** The handle returned to the realtime service. */
  handle: WatchHandle;
}

export interface MockRealtimeOptions {
  /** The RealtimeOptions object to pass to createRealtime. */
  options: RealtimeOptions;
  /** All watchSession calls captured in order. */
  watches: CapturedWatch[];
  /** sessionIds for which stopWatching was called. */
  stopped: string[];
  /** Override resolveSessionPath behavior. Default: returns "/mock/sessions/<id>.jsonl". */
  resolveSessionPath: (fn: (id: string) => Promise<string | null>) => void;
}

/**
 * Create mock RealtimeOptions that capture watchSession/stopWatching calls
 * and allow manual triggering of watcher callbacks.
 */
export function createMockRealtimeOptions(): MockRealtimeOptions {
  const watches: CapturedWatch[] = [];
  const stopped: string[] = [];

  // Create a temp directory with empty session files so Bun.file().text() works
  const tmpDir = mkdtempSync(join(tmpdir(), "realtime-test-"));
  const sessionFiles = new Map<string, string>();

  let resolveFn: (id: string) => Promise<string | null> = async (id) => {
    // Lazily create an empty file for each session
    if (!sessionFiles.has(id)) {
      const filePath = join(tmpDir, `${id}.jsonl`);
      writeFileSync(filePath, "");
      sessionFiles.set(id, filePath);
    }
    return sessionFiles.get(id)!;
  };

  const options: RealtimeOptions = {
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
    parseSession: () => createEmptyEnrichedSession(),
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

/** Creates an empty EnrichedSession for testing. */
function createEmptyEnrichedSession(): EnrichedSession {
  return {
    messages: [],
    turns: [],
    responses: [],
    toolCalls: [],
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      toolUseCount: 0,
    },
    toolStats: [],
    subagents: [],
    contextSnapshots: [],
    gitBranch: null,
    contextWindowSize: null,
  };
}

// ============================================================
// SSE Stream Utilities
// ============================================================

export interface SseEvent {
  type: string;
  data: unknown;
}

/**
 * Collect SSE events from a streaming response for a given duration.
 * Reads events without closing the stream, then cancels.
 */
export async function collectSseEvents(
  response: Response,
  durationMs = 50,
): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const deadline = Date.now() + durationMs;

  while (Date.now() < deadline) {
    const raceResult = await Promise.race([
      reader.read(),
      waitMs(Math.max(1, deadline - Date.now())).then(
        () => null,
      ),
    ]);

    if (raceResult === null || raceResult.done) break;

    buffer += decoder.decode(raceResult.value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;

    for (const part of parts) {
      if (!part.trim() || part.startsWith(":")) continue;

      let eventType = "message";
      let data = "";

      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }

      if (data) {
        try {
          events.push({ type: eventType, data: JSON.parse(data) });
        } catch {
          events.push({ type: eventType, data });
        }
      }
    }
  }

  await reader.cancel();
  reader.releaseLock();
  return events;
}

// ============================================================
// Utilities
// ============================================================

/** Promise-based delay for waiting on debounced timers in tests. */
export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A valid UUID v4 for use in tests. */
export const VALID_SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

/** A second valid UUID v4 for re-subscribe / multi-session tests. */
export const VALID_SESSION_ID_2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

/**
 * Flush pending async operations (microtasks from async handlers).
 * Yields to the event loop once so any resolved-but-pending continuations run.
 */
export function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Create a minimal WatchBatch for testing relay. */
export function createMockBatch(
  sessionId: string,
  messages: WatchBatch["messages"] = [],
  byteRange: WatchBatch["byteRange"] = { start: 0, end: 100 },
): WatchBatch {
  return { sessionId, messages, byteRange };
}
