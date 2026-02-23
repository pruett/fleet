import { join } from "node:path";
import { describe, test, expect } from "bun:test";
import { createApp } from "../create-app";
import {
  createMockDeps,
  createMockProject,
  createMockSession,
  createEmptyEnrichedSession,
} from "./helpers";

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

describe("POST /api/sessions", () => {
  test("returns 201 with sessionId on success", async () => {
    let receivedOpts: any = null;

    const deps = createMockDeps({
      controller: {
        startSession: async (opts) => {
          receivedOpts = opts;
          return { ok: true, sessionId: "new-session-123" };
        },
        stopSession: async () => ({ ok: true, sessionId: "" }),
        resumeSession: async () => ({ ok: true, sessionId: "" }),
        sendMessage: async () => ({ ok: true, sessionId: "" }),
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectDir: "/Users/test/project", prompt: "hello" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ sessionId: "new-session-123" });
    expect(receivedOpts).toEqual({
      projectDir: "/Users/test/project",
      prompt: "hello",
      cwd: undefined,
    });
  });

  test("returns 400 when projectDir is missing", async () => {
    const deps = createMockDeps();
    const app = createApp(deps);
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "projectDir is required" });
  });

  test("returns 500 when controller fails", async () => {
    const deps = createMockDeps({
      controller: {
        startSession: async () => ({
          ok: false,
          sessionId: "",
          error: "spawn failed",
        }),
        stopSession: async () => ({ ok: true, sessionId: "" }),
        resumeSession: async () => ({ ok: true, sessionId: "" }),
        sendMessage: async () => ({ ok: true, sessionId: "" }),
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectDir: "/Users/test/project" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "spawn failed" });
  });
});

describe("POST /api/sessions/:sessionId/stop", () => {
  test("returns 200 with sessionId on success", async () => {
    let receivedId = "";

    const deps = createMockDeps({
      controller: {
        startSession: async () => ({ ok: true, sessionId: "" }),
        stopSession: async (id) => {
          receivedId = id;
          return { ok: true, sessionId: id };
        },
        resumeSession: async () => ({ ok: true, sessionId: "" }),
        sendMessage: async () => ({ ok: true, sessionId: "" }),
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/sessions/sess-abc-123/stop", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sessionId: "sess-abc-123" });
    expect(receivedId).toBe("sess-abc-123");
  });

  test("returns 500 when controller fails", async () => {
    const deps = createMockDeps({
      controller: {
        startSession: async () => ({ ok: true, sessionId: "" }),
        stopSession: async () => ({
          ok: false,
          sessionId: "",
          error: "process not found",
        }),
        resumeSession: async () => ({ ok: true, sessionId: "" }),
        sendMessage: async () => ({ ok: true, sessionId: "" }),
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/sessions/sess-abc-123/stop", {
      method: "POST",
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "process not found" });
  });
});

describe("POST /api/sessions/:sessionId/resume", () => {
  test("returns 200 with sessionId on success", async () => {
    let receivedId = "";

    const deps = createMockDeps({
      controller: {
        startSession: async () => ({ ok: true, sessionId: "" }),
        stopSession: async () => ({ ok: true, sessionId: "" }),
        resumeSession: async (id) => {
          receivedId = id;
          return { ok: true, sessionId: id };
        },
        sendMessage: async () => ({ ok: true, sessionId: "" }),
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/sessions/sess-abc-123/resume", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sessionId: "sess-abc-123" });
    expect(receivedId).toBe("sess-abc-123");
  });

  test("returns 500 when controller fails", async () => {
    const deps = createMockDeps({
      controller: {
        startSession: async () => ({ ok: true, sessionId: "" }),
        stopSession: async () => ({ ok: true, sessionId: "" }),
        resumeSession: async () => ({
          ok: false,
          sessionId: "",
          error: "session not resumable",
        }),
        sendMessage: async () => ({ ok: true, sessionId: "" }),
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/sessions/sess-abc-123/resume", {
      method: "POST",
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "session not resumable" });
  });
});

describe("GET /api/sessions/:sessionId", () => {
  test("returns 200 with parsed session", async () => {
    const enriched = createEmptyEnrichedSession();
    let receivedContent = "";

    const deps = createMockDeps({
      basePaths: [join(FIXTURES, "resolve-base-1")],
      parser: {
        parseFullSession: (content) => {
          receivedContent = content;
          return enriched;
        },
      },
    });

    const app = createApp(deps);
    const res = await app.request(
      "/api/sessions/aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toEqual({ session: enriched });
    expect(typeof receivedContent).toBe("string");
  });

  test("returns 404 when session not found", async () => {
    const deps = createMockDeps({
      basePaths: [join(FIXTURES, "resolve-base-1")],
    });

    const app = createApp(deps);
    const res = await app.request(
      "/api/sessions/nonexistent-session-id",
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Session not found" });
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
