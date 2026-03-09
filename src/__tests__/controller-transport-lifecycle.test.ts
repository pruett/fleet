/**
 * Integration tests: Controller lifecycle events → SSE → SSE clients.
 *
 * Wires a real createController with a real createSse to verify that
 * lifecycle events emitted by the controller are correctly delivered to
 * connected SSE clients via pushEvent.
 */

import { describe, expect, it } from "bun:test";
import { createController } from "../controller/create-controller";
import { createSse } from "../sse/create-sse";
import type { LifecycleEvent } from "@fleet/shared";
import type { Sse } from "../sse/types";
import type { SpawnFn } from "../controller/types";
import type { Controller } from "../controller/create-controller";
import type { Subprocess } from "bun";
import {
  createMockSseOptions,
  collectSseEvents,
  flushAsync,
  VALID_SESSION_ID,
} from "../sse/__tests__/helpers";

// ============================================================
// Mock Subprocess (same pattern as controller tests)
// ============================================================

interface MockSubprocess {
  proc: Subprocess;
  exit: (code: number) => void;
}

function createMockSubprocess(cmd: string[]): MockSubprocess {
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
    kill(signal?: string | number) {},
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

/**
 * Create a controller wired to an SSE service's pushEvent.
 * Returns both the controller and the spawn mock for test control.
 */
function createWiredSystem(sse: Sse) {
  const spawn = createMockSpawn();
  const controller = createController({
    onLifecycleEvent: (event) => sse.pushEvent(event),
    spawn: spawn.fn,
  });
  return { controller, spawn };
}

// ============================================================
// Tests
// ============================================================

describe("Controller → SSE lifecycle integration", () => {
  it("sendMessage lifecycle event is delivered to connected SSE clients", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);
    const { controller, spawn } = createWiredSystem(sse);

    // Connect two clients via SSE
    const r1 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();
    const r2 = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    // Send a message — should trigger lifecycle event
    await controller.sendMessage(VALID_SESSION_ID, "hello");

    // Collect events from both streams
    const events1 = await collectSseEvents(r1, 50);
    const events2 = await collectSseEvents(r2, 50);

    const lifecycle1 = events1.filter((e) =>
      typeof e.type === "string" && e.type.startsWith("session:"),
    );
    const lifecycle2 = events2.filter((e) =>
      typeof e.type === "string" && e.type.startsWith("session:"),
    );

    expect(lifecycle1).toHaveLength(1);
    expect(lifecycle2).toHaveLength(1);
    expect((lifecycle1[0].data as Record<string, unknown>).sessionId).toBe(VALID_SESSION_ID);
    expect((lifecycle2[0].data as Record<string, unknown>).sessionId).toBe(VALID_SESSION_ID);

    sse.shutdown();
  });

  it("client receives complete lifecycle sequence after process exits successfully", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);
    const { controller, spawn } = createWiredSystem(sse);

    const r = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    await controller.sendMessage(VALID_SESSION_ID, "hello");
    spawn.calls[0].exit(0);
    await flushAsync();

    const events = await collectSseEvents(r, 100);
    const lifecycle = events.filter((e) =>
      typeof e.type === "string" && e.type.startsWith("session:"),
    );

    // Should receive 2 lifecycle events: activity + stopped
    expect(lifecycle).toHaveLength(2);
    const lastEvent = lifecycle[lifecycle.length - 1].data as Record<string, unknown>;
    expect(lastEvent.type).toBe("session:stopped");
    expect(lastEvent.sessionId).toBe(VALID_SESSION_ID);
    expect(lastEvent.reason).toBe("completed");

    sse.shutdown();
  });

  it("client receives error lifecycle sequence on non-zero exit", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);
    const { controller, spawn } = createWiredSystem(sse);

    const r = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    await controller.sendMessage(VALID_SESSION_ID, "hello");
    spawn.calls[0].exit(1);
    await flushAsync();

    const events = await collectSseEvents(r, 100);
    const lifecycle = events.filter((e) =>
      typeof e.type === "string" && e.type.startsWith("session:"),
    );

    // Should receive 3 lifecycle events: activity + error + stopped
    expect(lifecycle).toHaveLength(3);

    const types = lifecycle.map((e) => (e.data as Record<string, unknown>).type);
    expect(types).toContain("session:error");
    expect(types).toContain("session:stopped");

    const lastEvent = lifecycle[lifecycle.length - 1].data as Record<string, unknown>;
    expect(lastEvent.type).toBe("session:stopped");
    expect(lastEvent.reason).toBe("errored");

    sse.shutdown();
  });

  it("all lifecycle events are valid JSON with a type field", async () => {
    const mock = createMockSseOptions();
    const sse = createSse(mock.options);
    const { controller, spawn } = createWiredSystem(sse);

    const r = await sse.handleSessionStream(VALID_SESSION_ID);
    await flushAsync();

    await controller.sendMessage(VALID_SESSION_ID, "hello");
    spawn.calls[0].exit(1);
    await flushAsync();

    const events = await collectSseEvents(r, 100);

    for (const event of events) {
      expect(typeof event.data).toBe("object");
      expect(event.data).not.toBeNull();
      expect(typeof (event.data as Record<string, unknown>).type).toBe("string");
    }

    sse.shutdown();
  });
});
