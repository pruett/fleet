import { join } from "node:path";
import { describe, test, expect } from "bun:test";
import { createApp } from "../create-app";
import { createMockDeps, createMockProject, createMockSession } from "./helpers";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("GET /api/projects", () => {
  test("returns 200 with projects array", async () => {
    const projects = [
      createMockProject({ id: "-Users-foo-code-bar", sessionCount: 3 }),
      createMockProject({ id: "-Users-foo-code-baz", sessionCount: 1 }),
    ];

    const deps = createMockDeps({
      scanner: {
        scanProjects: async () => projects,
        scanSessions: async () => [],
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/projects");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toEqual({ projects });
  });

  test("passes basePaths to scanner.scanProjects", async () => {
    const basePaths = ["/path/one", "/path/two"];
    let receivedPaths: string[] = [];

    const deps = createMockDeps({
      basePaths,
      scanner: {
        scanProjects: async (paths) => {
          receivedPaths = paths;
          return [];
        },
        scanSessions: async () => [],
      },
    });

    const app = createApp(deps);
    await app.request("/api/projects");

    expect(receivedPaths).toEqual(basePaths);
  });

  test("returns empty array when no projects exist", async () => {
    const deps = createMockDeps();
    const app = createApp(deps);
    const res = await app.request("/api/projects");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ projects: [] });
  });
});

describe("GET /api/projects/:projectId/sessions", () => {
  test("returns 200 with sessions array", async () => {
    const sessions = [
      createMockSession({ sessionId: "sess-1" }),
      createMockSession({ sessionId: "sess-2" }),
    ];
    let receivedDir = "";

    const deps = createMockDeps({
      basePaths: [join(FIXTURES, "resolve-base-1")],
      scanner: {
        scanProjects: async () => [],
        scanSessions: async (dir) => {
          receivedDir = dir;
          return sessions;
        },
      },
    });

    const app = createApp(deps);
    const res = await app.request(
      "/api/projects/-Users-project-alpha/sessions",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toEqual({ sessions });
    expect(receivedDir).toBe(
      join(FIXTURES, "resolve-base-1", "-Users-project-alpha"),
    );
  });

  test("returns 404 when project not found", async () => {
    const deps = createMockDeps({
      basePaths: [join(FIXTURES, "resolve-base-1")],
    });

    const app = createApp(deps);
    const res = await app.request(
      "/api/projects/-Users-nonexistent/sessions",
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Project not found" });
  });
});
