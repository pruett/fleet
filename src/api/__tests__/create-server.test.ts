import { describe, test, expect } from "bun:test";
import { createServer } from "../create-server";
import { createMockDeps } from "./helpers";

describe("createServer", () => {
  test("returns object with fetch property (no websocket)", () => {
    const server = createServer(createMockDeps());
    expect(typeof server.fetch).toBe("function");
    expect(server).not.toHaveProperty("websocket");
  });

  describe("HTTP passthrough", () => {
    test("non-API requests pass through to Hono app", async () => {
      const deps = createMockDeps({
        scanner: {
          scanProjects: async () => [],
          scanSessions: async () => [],
          groupProjects: () => [],
          scanWorktrees: async () => [],
        },
      });
      const server = createServer(deps);

      const result = await server.fetch(
        new Request("http://localhost/api/projects"),
      );

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(200);
      const body = await result.json();
      expect(body).toEqual({ projects: [] });
    });

    test("404 for unknown API routes", async () => {
      const server = createServer(createMockDeps());

      const result = await server.fetch(
        new Request("http://localhost/api/nonexistent"),
      );

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(404);
    });
  });
});
