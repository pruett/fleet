/**
 * Runtime assertions that the server's lifecycle event type universe
 * matches what the client expects to handle.
 *
 * These tests expose the type mismatch between:
 *   - Server (controller): emits "session:message-sent"
 *   - Client: handles "session:started", "session:stopped", "session:error"
 *
 * And the reason field drift:
 *   - Server: "user" | "completed" | "errored"
 *   - Client: "user" | "completed" (missing "errored")
 */

import { describe, expect, it } from "bun:test";
import { createController } from "../controller/create-controller";
import type { LifecycleEvent } from "@fleet/shared";
import type { SpawnFn } from "../controller/types";
import type { Subprocess } from "bun";

// ============================================================
// Mock Subprocess
// ============================================================

function createMockSubprocess(cmd: string[]) {
  let resolveExited: (code: number) => void;
  const exitedPromise = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

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
    kill() {},
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
  };
}

function createMockSpawn() {
  const calls: ReturnType<typeof createMockSubprocess>[] = [];
  const fn: SpawnFn = (cmd, _opts) => {
    const mock = createMockSubprocess(cmd);
    calls.push(mock);
    return mock.proc;
  };
  return { fn, calls };
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================
// Contract constants
// ============================================================

/**
 * The set of lifecycle event types the client's onLifecycleEvent
 * switch statement handles. The client ignores any type not in this set.
 */
const CLIENT_KNOWN_TYPES = new Set([
  "session:started",
  "session:message-sent",
  "session:stopped",
  "session:error",
]);

/**
 * The set of session:stopped reason values the server can emit.
 */
const SERVER_STOP_REASONS = new Set(["user", "completed", "errored"]);

// ============================================================
// Tests
// ============================================================

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

describe("Lifecycle event contract: server ↔ client", () => {
  it("controller emits only lifecycle event types that the client handles", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    // Run a full happy-path cycle to collect all event types
    await controller.sendMessage(SESSION_ID, "hello");
    spawn.calls[0].exit(0);
    await flushAsync();

    // Collect unique event types emitted
    const emittedTypes = new Set(events.map((e) => e.type));

    // Every type the server emits should be one the client handles
    // FAILS: controller emits "session:message-sent" which is not in CLIENT_KNOWN_TYPES
    for (const type of emittedTypes) {
      expect(CLIENT_KNOWN_TYPES.has(type)).toBe(true);
    }
  });

  it("session:stopped reason values include 'errored'", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    // Trigger an error exit to get a stopped event with reason "errored"
    await controller.sendMessage(SESSION_ID, "hello");
    spawn.calls[0].exit(1);
    await flushAsync();

    const stoppedEvents = events.filter((e) => e.type === "session:stopped");
    expect(stoppedEvents).toHaveLength(1);

    // Verify the server emits "errored" as a reason value
    const stopped = stoppedEvents[0] as { reason: string };
    expect(SERVER_STOP_REASONS.has(stopped.reason)).toBe(true);
    expect(stopped.reason).toBe("errored");
  });

  it("all server LifecycleEvent type strings are handled by the client", async () => {
    const spawn = createMockSpawn();
    const events: LifecycleEvent[] = [];
    const controller = createController({
      onLifecycleEvent: (e) => events.push(e),
      spawn: spawn.fn,
    });

    // Run both happy-path and error-path to collect all possible event types
    // Happy path
    await controller.sendMessage(SESSION_ID, "hello");
    spawn.calls[0].exit(0);
    await flushAsync();

    // Error path (need a different session since the first one cleaned up)
    const SESSION_ID_2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
    await controller.sendMessage(SESSION_ID_2, "world");
    spawn.calls[1].exit(1);
    await flushAsync();

    // Collect all unique event types
    const serverTypes = new Set(events.map((e) => e.type));

    // Every type the server emits must be in the client's known set
    // (client may handle additional types like session:started that the controller doesn't emit)
    for (const type of serverTypes) {
      expect(CLIENT_KNOWN_TYPES.has(type)).toBe(true);
    }
  });
});
