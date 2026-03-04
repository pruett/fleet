/**
 * Integration tests: Controller lifecycle events → Transport → WebSocket clients.
 *
 * Wires a real createController with a real createTransport using mock WebSockets
 * to verify that lifecycle events emitted by the controller are correctly broadcast
 * to all connected WebSocket clients.
 */

import { describe, expect, it } from "bun:test";
import { createController } from "../controller/create-controller";
import { createTransport } from "../transport/create-transport";
import type { LifecycleEvent, Transport } from "../transport/types";
import type { SpawnFn } from "../controller/types";
import type { Controller } from "../controller/create-controller";
import type { Subprocess } from "bun";
import {
  createMockWebSocket,
  createMockTransportOptions,
  flushAsync,
  VALID_SESSION_ID,
} from "../transport/__tests__/helpers";

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

/** Extract lifecycle frames (type starts with "session:") from a mock WS's sent buffer. */
function getLifecycleFrames(sent: string[]): Record<string, unknown>[] {
  return sent
    .map((s) => JSON.parse(s))
    .filter(
      (f: Record<string, unknown>) =>
        typeof f.type === "string" &&
        (f.type as string).startsWith("session:"),
    );
}

/**
 * Create a controller wired to a transport's broadcastLifecycleEvent.
 * Returns both the controller and the spawn mock for test control.
 */
function createWiredSystem(transport: Transport) {
  const spawn = createMockSpawn();
  const controller = createController({
    onLifecycleEvent: (event) => transport.broadcastLifecycleEvent(event),
    spawn: spawn.fn,
  });
  return { controller, spawn };
}

// ============================================================
// Tests
// ============================================================

describe("Controller → Transport lifecycle integration", () => {
  it("sendMessage lifecycle event is broadcast to all connected WebSocket clients", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { controller, spawn } = createWiredSystem(transport);

    // Connect two clients
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    transport.handleOpen(ws1.ws);
    transport.handleOpen(ws2.ws);

    // Send a message — should trigger lifecycle event broadcast
    await controller.sendMessage(VALID_SESSION_ID, "hello");

    // Both clients should receive the lifecycle frame
    const frames1 = getLifecycleFrames(ws1.sent);
    const frames2 = getLifecycleFrames(ws2.sent);

    expect(frames1).toHaveLength(1);
    expect(frames2).toHaveLength(1);
    expect(frames1[0].sessionId).toBe(VALID_SESSION_ID);
    expect(frames2[0].sessionId).toBe(VALID_SESSION_ID);
  });

  it("client receives complete lifecycle sequence after process exits successfully", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { controller, spawn } = createWiredSystem(transport);

    const ws = createMockWebSocket();
    transport.handleOpen(ws.ws);

    await controller.sendMessage(VALID_SESSION_ID, "hello");
    spawn.calls[0].exit(0);
    await flushAsync();

    const frames = getLifecycleFrames(ws.sent);

    // Should receive 2 lifecycle frames: start signal + stopped
    expect(frames).toHaveLength(2);
    expect(frames[frames.length - 1]).toMatchObject({
      type: "session:stopped",
      sessionId: VALID_SESSION_ID,
      reason: "completed",
    });
  });

  it("client receives error lifecycle sequence on non-zero exit", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { controller, spawn } = createWiredSystem(transport);

    const ws = createMockWebSocket();
    transport.handleOpen(ws.ws);

    await controller.sendMessage(VALID_SESSION_ID, "hello");
    spawn.calls[0].exit(1);
    await flushAsync();

    const frames = getLifecycleFrames(ws.sent);

    // Should receive 3 lifecycle frames: start signal + error + stopped
    expect(frames).toHaveLength(3);

    const types = frames.map((f) => f.type);
    expect(types).toContain("session:error");
    expect(types).toContain("session:stopped");

    // Stopped should be last with reason "errored"
    expect(frames[frames.length - 1]).toMatchObject({
      type: "session:stopped",
      reason: "errored",
    });
  });

  it("all lifecycle frames are valid JSON parseable by the client", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { controller, spawn } = createWiredSystem(transport);

    const ws = createMockWebSocket();
    transport.handleOpen(ws.ws);

    await controller.sendMessage(VALID_SESSION_ID, "hello");
    spawn.calls[0].exit(1);
    await flushAsync();

    // Every sent string should parse as valid JSON with a type field
    for (const raw of ws.sent) {
      const parsed = JSON.parse(raw);
      expect(typeof parsed).toBe("object");
      expect(parsed).not.toBeNull();
      expect(typeof parsed.type).toBe("string");
    }
  });

  it("session:stopped with reason 'errored' is correctly serialized", async () => {
    const mock = createMockTransportOptions();
    const transport = createTransport(mock.options);
    const { controller, spawn } = createWiredSystem(transport);

    const ws = createMockWebSocket();
    transport.handleOpen(ws.ws);

    await controller.sendMessage(VALID_SESSION_ID, "hello");
    spawn.calls[0].exit(1);
    await flushAsync();

    const frames = getLifecycleFrames(ws.sent);
    const stoppedFrame = frames.find((f) => f.type === "session:stopped");

    expect(stoppedFrame).toBeDefined();
    expect(stoppedFrame!.reason).toBe("errored");
    expect(stoppedFrame!.sessionId).toBe(VALID_SESSION_ID);
    expect(typeof stoppedFrame!.stoppedAt).toBe("string");
  });
});
