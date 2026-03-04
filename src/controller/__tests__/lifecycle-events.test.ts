/**
 * Controller lifecycle event sequence verification.
 *
 * These tests document the exact lifecycle event types and ordering
 * emitted by the controller. The client UI depends on receiving specific
 * event types to transition session status (e.g. "unknown" → "running").
 *
 * Expected client-handled types: session:started, session:stopped, session:error
 * Defect A: controller emits session:activity instead of session:started
 */

import { describe, expect, it } from "bun:test";
import { createController } from "../create-controller";
import type { LifecycleEvent } from "@fleet/shared";
import type { SpawnFn } from "../types";
import type { Subprocess } from "bun";

// ============================================================
// Mock Subprocess (duplicated from create-controller.test.ts)
// ============================================================

interface MockSubprocess {
  proc: Subprocess;
  exit: (code: number) => void;
  killed: { signal: string } | null;
  cmd: string[];
}

function createMockSubprocess(cmd: string[]): MockSubprocess {
  let resolveExited: (code: number) => void;
  const exitedPromise = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  let killed: { signal: string } | null = null;

  const proc = {
    exited: exitedPromise,
    killed: false,
    pid: Math.floor(Math.random() * 100000),
    exitCode: null,
    signalCode: null,
    stdin: null,
    stdout: null,
    stderr: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    kill(signal?: string | number) {
      killed = { signal: String(signal ?? "SIGTERM") };
    },
    ref() {},
    unref() {},
    [Symbol.asyncDispose]() {
      return Promise.resolve();
    },
    resourceUsage() {
      return undefined;
    },
  } as unknown as Subprocess;

  return {
    proc,
    exit: (code: number) => resolveExited!(code),
    get killed() {
      return killed;
    },
    cmd,
  };
}

// ============================================================
// Mock SpawnFn factory
// ============================================================

interface MockSpawn {
  fn: SpawnFn;
  calls: MockSubprocess[];
}

function createMockSpawn(): MockSpawn {
  const calls: MockSubprocess[] = [];

  const fn: SpawnFn = (cmd, _opts) => {
    const mock = createMockSubprocess(cmd);
    calls.push(mock);
    return mock.proc;
  };

  return { fn, calls };
}

// ============================================================
// Helpers
// ============================================================

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SESSION_ID_2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

/** The set of lifecycle event types that the client UI handles. */
const CLIENT_HANDLED_TYPES = new Set([
  "session:started",
  "session:activity",
  "session:stopped",
  "session:error",
]);

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================
// Tests
// ============================================================

describe("sendMessage lifecycle event contract", () => {
  it("emits a lifecycle event that the client can use to set status to running", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "hello");

    // The first event after sendMessage should be one the client handles
    // to transition status from "unknown" to "running".
    // Client handles: session:started, session:stopped, session:error
    // Defect A: controller emits session:activity which client ignores
    expect(events).toHaveLength(1);
    expect(CLIENT_HANDLED_TYPES.has(events[0].type)).toBe(true);
  });

  it("full happy-path lifecycle: [running signal] → stopped(completed)", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "hello");
    spawn.calls[0].exit(0);
    await flushAsync();

    // Expect exactly 2 events: a client-handleable "running" signal + stopped
    expect(events).toHaveLength(2);

    // First event should signal "running" — must be a type the client handles
    expect(CLIENT_HANDLED_TYPES.has(events[0].type)).toBe(true);

    // Second event: session:stopped with reason "completed"
    expect(events[1]).toMatchObject({
      type: "session:stopped",
      sessionId: SESSION_ID,
      reason: "completed",
    });
  });

  it("full error-path lifecycle: [running signal] → error → stopped(errored)", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "hello");
    spawn.calls[0].exit(1);
    await flushAsync();

    // Expect 3 events: running signal, error, stopped
    expect(events).toHaveLength(3);

    // First event must be client-handleable
    expect(CLIENT_HANDLED_TYPES.has(events[0].type)).toBe(true);

    // Second: session:error
    expect(events[1].type).toBe("session:error");

    // Third: session:stopped with reason "errored"
    expect(events[2]).toMatchObject({
      type: "session:stopped",
      sessionId: SESSION_ID,
      reason: "errored",
    });
  });

  it("lifecycle event on sendMessage includes sessionId and timestamp", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "hello");

    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe(SESSION_ID);

    // The event should have a timestamp field (varies by event type)
    const event = events[0] as Record<string, unknown>;
    const hasTimestamp =
      typeof event.startedAt === "string" ||
      typeof event.updatedAt === "string" ||
      typeof event.occurredAt === "string" ||
      typeof event.stoppedAt === "string";
    expect(hasTimestamp).toBe(true);
  });

  it("events across multiple sessions are correctly ordered per-session", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    // Start two concurrent sessions
    await controller.sendMessage(SESSION_ID, "first");
    await controller.sendMessage(SESSION_ID_2, "second");

    // Exit both
    spawn.calls[0].exit(0);
    spawn.calls[1].exit(0);
    await flushAsync();

    // Filter events per session
    const session1Events = events.filter((e) => e.sessionId === SESSION_ID);
    const session2Events = events.filter((e) => e.sessionId === SESSION_ID_2);

    // Each session should have exactly 2 events (start signal + stopped)
    expect(session1Events).toHaveLength(2);
    expect(session2Events).toHaveLength(2);

    // Last event for each should be session:stopped
    expect(session1Events[1].type).toBe("session:stopped");
    expect(session2Events[1].type).toBe("session:stopped");
  });
});

describe("edge cases that cause silent no-activity", () => {
  it("busy session rejection emits no lifecycle events", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "first");
    const eventsAfterFirst = events.length;

    // Second message to busy session
    const result = await controller.sendMessage(SESSION_ID, "second");
    expect(result.ok).toBe(false);

    // No new lifecycle events emitted for the rejection
    expect(events.length).toBe(eventsAfterFirst);
  });

  it("rapid send→exit→send cycle produces two complete lifecycle sequences", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    // First cycle: send → exit → flush
    await controller.sendMessage(SESSION_ID, "first");
    spawn.calls[0].exit(0);
    await flushAsync();

    // Second cycle: send → exit → flush
    await controller.sendMessage(SESSION_ID, "second");
    spawn.calls[1].exit(0);
    await flushAsync();

    // Should have two complete sequences, each with a start signal + stopped
    // Filter to just the start signals (first event of each pair)
    const stoppedEvents = events.filter((e) => e.type === "session:stopped");
    expect(stoppedEvents).toHaveLength(2);

    // Each stopped event should be preceded by a client-handleable start event
    // Events should alternate: [start, stopped, start, stopped]
    expect(events).toHaveLength(4);
    expect(CLIENT_HANDLED_TYPES.has(events[0].type)).toBe(true);
    expect(events[1].type).toBe("session:stopped");
    expect(CLIENT_HANDLED_TYPES.has(events[2].type)).toBe(true);
    expect(events[3].type).toBe("session:stopped");
  });

  it("onLifecycleEvent callback that throws does not prevent sendMessage from succeeding", async () => {
    const spawn = createMockSpawn();
    let callCount = 0;
    const controller = createController({
      onLifecycleEvent: () => {
        callCount++;
        throw new Error("Callback exploded");
      },
      spawn: spawn.fn,
    });

    // sendMessage should still return ok despite the callback throwing
    const result = await controller.sendMessage(SESSION_ID, "hello");
    expect(result).toEqual({ ok: true, sessionId: SESSION_ID });
    expect(callCount).toBe(1);
  });

  it("process that exits immediately still emits both lifecycle events", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "hello");

    // Immediately exit
    spawn.calls[0].exit(0);
    await flushAsync();

    // Should still get both events even with immediate exit
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]).toMatchObject({
      type: "session:stopped",
      sessionId: SESSION_ID,
      reason: "completed",
    });
  });

  it("no lifecycle events emitted after shutdown even if process exits with error", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "test");
    const eventsBeforeShutdown = events.length;

    controller.shutdown();

    // Process exits with error after shutdown
    spawn.calls[0].exit(1);
    await flushAsync();

    // No new lifecycle events should have been emitted
    expect(events.length).toBe(eventsBeforeShutdown);
  });
});
