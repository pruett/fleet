import { describe, expect, it } from "bun:test";
import { createController } from "../create-controller";
import type { LifecycleEvent } from "../../transport";
import type { SpawnFn } from "../types";
import type { Subprocess } from "bun";

// ============================================================
// Mock Subprocess
// ============================================================

interface MockSubprocess {
  /** The mock cast as Subprocess for use with controller. */
  proc: Subprocess;
  /** Resolve the `exited` promise with a given exit code. */
  exit: (code: number) => void;
  /** Whether kill() was called, and with what signal. */
  killed: { signal: string } | null;
  /** The command that was passed to spawn. */
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

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================
// Tests
// ============================================================

describe("createController — sendMessage", () => {
  it("spawns correct CLI command with right flags", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    const result = await controller.sendMessage(SESSION_ID, "hello world");

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID });
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].cmd).toEqual([
      "claude",
      "-p",
      "--resume",
      SESSION_ID,
      "--",
      "hello world",
    ]);
  });

  it("broadcasts session:activity on spawn", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "test");

    const activityEvents = events.filter((e) => e.type === "session:activity");
    expect(activityEvents).toHaveLength(1);
    expect(activityEvents[0].sessionId).toBe(SESSION_ID);
  });

  it("rejects when session is busy (process already running)", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    // First message — succeeds
    const result1 = await controller.sendMessage(SESSION_ID, "first");
    expect(result1.ok).toBe(true);

    // Second message to same session — rejected
    const result2 = await controller.sendMessage(SESSION_ID, "second");
    expect(result2).toEqual({
      ok: false,
      sessionId: SESSION_ID,
      error: "Session is busy",
    });

    // Only one process spawned
    expect(spawn.calls).toHaveLength(1);
  });

  it("allows message to different session while one is running", async () => {
    const spawn = createMockSpawn();
    const controller = createController({
      onLifecycleEvent: () => {},
      spawn: spawn.fn,
    });

    const result1 = await controller.sendMessage(SESSION_ID, "first");
    const result2 = await controller.sendMessage(SESSION_ID_2, "second");

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    expect(spawn.calls).toHaveLength(2);
  });

  it("process exit triggers registry cleanup and lifecycle broadcast", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "test");

    // Process exits successfully
    spawn.calls[0].exit(0);
    await flushAsync();

    // Should broadcast session:stopped with reason "completed"
    const stopEvents = events.filter((e) => e.type === "session:stopped");
    expect(stopEvents).toHaveLength(1);
    expect(stopEvents[0]).toMatchObject({
      type: "session:stopped",
      sessionId: SESSION_ID,
      reason: "completed",
    });

    // Registry cleaned up — can send another message
    const result = await controller.sendMessage(SESSION_ID, "second");
    expect(result.ok).toBe(true);
  });

  it("non-zero exit broadcasts session:error then session:stopped with reason errored", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "test");

    spawn.calls[0].exit(1);
    await flushAsync();

    const errorEvents = events.filter((e) => e.type === "session:error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toMatchObject({
      type: "session:error",
      sessionId: SESSION_ID,
    });

    const stopEvents = events.filter((e) => e.type === "session:stopped");
    expect(stopEvents).toHaveLength(1);
    expect(stopEvents[0]).toMatchObject({
      type: "session:stopped",
      sessionId: SESSION_ID,
      reason: "errored",
    });
  });
});

describe("createController — stopSession", () => {
  it("sends SIGINT and waits for process to exit", async () => {
    const spawn = createMockSpawn();
    const controller = createController({
      onLifecycleEvent: () => {},
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "test");

    // Simulate the process exiting after SIGINT is sent
    const stopPromise = controller.stopSession(SESSION_ID);
    spawn.calls[0].exit(0);
    const result = await stopPromise;

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID });
    expect(spawn.calls[0].killed).toEqual({ signal: "SIGINT" });
  });

  it("returns error when no running process", async () => {
    const spawn = createMockSpawn();
    const controller = createController({
      onLifecycleEvent: () => {},
      spawn: spawn.fn,
    });

    const result = await controller.stopSession(SESSION_ID);

    expect(result).toEqual({
      ok: false,
      sessionId: SESSION_ID,
      error: "No running process",
    });
  });
});

describe("createController — resumeSession", () => {
  it("returns stub error directing to sendMessage", async () => {
    const controller = createController({
      onLifecycleEvent: () => {},
      spawn: createMockSpawn().fn,
    });

    const result = await controller.resumeSession(SESSION_ID);

    expect(result).toEqual({
      ok: false,
      sessionId: SESSION_ID,
      error: "Use sendMessage to continue a conversation",
    });
  });
});

describe("createController — startSession", () => {
  it("returns not implemented", async () => {
    const controller = createController({
      onLifecycleEvent: () => {},
      spawn: createMockSpawn().fn,
    });

    const result = await controller.startSession({ projectDir: "/tmp" });

    expect(result).toEqual({
      ok: false,
      sessionId: "",
      error: "Not implemented",
    });
  });
});

describe("createController — shutdown", () => {
  it("kills all tracked processes with SIGTERM", async () => {
    const spawn = createMockSpawn();
    const controller = createController({
      onLifecycleEvent: () => {},
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "first");
    await controller.sendMessage(SESSION_ID_2, "second");

    expect(spawn.calls).toHaveLength(2);

    controller.shutdown();

    expect(spawn.calls[0].killed).toEqual({ signal: "SIGTERM" });
    expect(spawn.calls[1].killed).toEqual({ signal: "SIGTERM" });
  });

  it("clears registry so subsequent messages can be sent", async () => {
    const spawn = createMockSpawn();
    const controller = createController({
      onLifecycleEvent: () => {},
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "first");
    controller.shutdown();

    // Registry cleared — new message should work (not "Session is busy")
    const result = await controller.sendMessage(SESSION_ID, "second");
    expect(result.ok).toBe(true);
    expect(spawn.calls).toHaveLength(2);
  });

  it("does not broadcast lifecycle events after shutdown", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    await controller.sendMessage(SESSION_ID, "test");
    const eventsBeforeShutdown = events.length;

    controller.shutdown();

    // Process exits after shutdown
    spawn.calls[0].exit(1);
    await flushAsync();

    // No new lifecycle events should have been broadcast
    expect(events.length).toBe(eventsBeforeShutdown);
  });

  it("shutdown with no tracked processes is a no-op", () => {
    const controller = createController({
      onLifecycleEvent: () => {},
      spawn: createMockSpawn().fn,
    });

    // Should not throw
    controller.shutdown();
  });
});
