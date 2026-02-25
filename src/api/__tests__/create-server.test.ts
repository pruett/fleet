import { describe, test, expect, mock } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { createServer } from "../create-server";
import { createMockDeps } from "./helpers";

// --- Mock helpers ---

function createMockServer(upgradeResult = true) {
  return {
    upgrade: mock(() => upgradeResult),
  } as unknown as Server<undefined>;
}

function createMockWs() {
  return {
    send: mock(() => {}),
    close: mock(() => {}),
  } as unknown as ServerWebSocket<unknown>;
}

function wsUpgradeRequest(path = "/ws") {
  return new Request(`http://localhost${path}`, {
    headers: { Upgrade: "websocket" },
  });
}

// --- Tests ---

describe("createServer", () => {
  test("returns object with fetch and websocket properties", () => {
    const server = createServer(createMockDeps());
    expect(typeof server.fetch).toBe("function");
    expect(typeof server.websocket.open).toBe("function");
    expect(typeof server.websocket.message).toBe("function");
    expect(typeof server.websocket.close).toBe("function");
  });

  describe("fetch — WebSocket upgrade", () => {
    test("upgrades requests to /ws path", () => {
      const mockServer = createMockServer(true);
      const server = createServer(createMockDeps());

      const result = server.fetch(wsUpgradeRequest("/ws"), mockServer);

      expect(mockServer.upgrade).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
    });

    test("returns 400 when upgrade fails", () => {
      const mockServer = createMockServer(false);
      const server = createServer(createMockDeps());

      const result = server.fetch(wsUpgradeRequest("/ws"), mockServer);

      expect(mockServer.upgrade).toHaveBeenCalledTimes(1);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(400);
    });

    test("does not upgrade requests to other paths", async () => {
      const mockServer = createMockServer(true);
      const server = createServer(createMockDeps());

      const result = await server.fetch(
        new Request("http://localhost/api/projects"),
        mockServer,
      );

      expect(mockServer.upgrade).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
      // Hono handles the request — returns JSON from the app
      expect((result as Response).status).toBe(200);
    });

    test("does not upgrade requests to /ws/ with trailing slash", async () => {
      const mockServer = createMockServer(true);
      const server = createServer(createMockDeps());

      const result = await server.fetch(
        new Request("http://localhost/ws/"),
        mockServer,
      );

      expect(mockServer.upgrade).not.toHaveBeenCalled();
    });

    test("does not upgrade requests to /ws/sub-path", async () => {
      const mockServer = createMockServer(true);
      const server = createServer(createMockDeps());

      const result = await server.fetch(
        new Request("http://localhost/ws/something"),
        mockServer,
      );

      expect(mockServer.upgrade).not.toHaveBeenCalled();
    });
  });

  describe("websocket — transport delegation", () => {
    test("open delegates to transport.handleOpen", () => {
      const handleOpen = mock(() => {});
      const deps = createMockDeps({
        transport: {
          handleOpen,
          handleMessage: () => {},
          handleClose: () => {},
          broadcastLifecycleEvent: () => {},
          getClientCount: () => 0,
          getSessionSubscriberCount: () => 0,
          shutdown: () => {},
        },
      });

      const server = createServer(deps);
      const ws = createMockWs();

      server.websocket.open(ws);
      expect(handleOpen).toHaveBeenCalledTimes(1);
      expect(handleOpen).toHaveBeenCalledWith(ws);
    });

    test("message delegates to transport.handleMessage", () => {
      const handleMessage = mock(() => {});
      const deps = createMockDeps({
        transport: {
          handleOpen: () => {},
          handleMessage,
          handleClose: () => {},
          broadcastLifecycleEvent: () => {},
          getClientCount: () => 0,
          getSessionSubscriberCount: () => 0,
          shutdown: () => {},
        },
      });

      const server = createServer(deps);
      const ws = createMockWs();
      const data = JSON.stringify({ type: "subscribe", sessionId: "test" });

      server.websocket.message(ws, data);
      expect(handleMessage).toHaveBeenCalledTimes(1);
      expect(handleMessage).toHaveBeenCalledWith(ws, data);
    });

    test("close delegates to transport.handleClose", () => {
      const handleClose = mock(() => {});
      const deps = createMockDeps({
        transport: {
          handleOpen: () => {},
          handleMessage: () => {},
          handleClose,
          broadcastLifecycleEvent: () => {},
          getClientCount: () => 0,
          getSessionSubscriberCount: () => 0,
          shutdown: () => {},
        },
      });

      const server = createServer(deps);
      const ws = createMockWs();

      server.websocket.close(ws);
      expect(handleClose).toHaveBeenCalledTimes(1);
      expect(handleClose).toHaveBeenCalledWith(ws);
    });
  });

  describe("HTTP passthrough", () => {
    test("non-WebSocket requests pass through to Hono app", async () => {
      const deps = createMockDeps({
        scanner: {
          scanProjects: async () => [],
          scanSessions: async () => [],
          groupProjects: () => [],
        },
      });
      const mockServer = createMockServer(true);
      const server = createServer(deps);

      const result = await server.fetch(
        new Request("http://localhost/api/projects"),
        mockServer,
      );

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ projects: [] });
    });

    test("404 for unknown API routes", async () => {
      const mockServer = createMockServer(true);
      const server = createServer(createMockDeps());

      const result = await server.fetch(
        new Request("http://localhost/api/nonexistent"),
        mockServer,
      );

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(404);
    });
  });
});
