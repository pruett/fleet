import { join } from "node:path";
import { describe, test, expect } from "bun:test";
import { createApp } from "../create-app";
import type { GroupedProject } from "../../scanner/types";
import {
  createMockDeps,
  createMockProject,
  createMockSession,
  createEmptyEnrichedSession,
} from "./helpers";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("GET /api/projects", () => {
  test("returns 200 with grouped projects array", async () => {
    const grouped: GroupedProject[] = [
      {
        slug: "bar",
        title: "bar",
        projectDirs: ["-Users-foo-code-bar"],
        matchedDirIds: ["-Users-foo-code-bar"],
        sessionCount: 3,
        lastActiveAt: null,
      },
    ];

    const deps = createMockDeps({
      scanner: {
        scanProjects: async () => [],
        scanSessions: async () => [],
        groupProjects: () => grouped,
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/projects");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toEqual({ projects: grouped });
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
        groupProjects: () => [],
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

describe("GET /api/directories", () => {
  test("returns 200 with raw project directories", async () => {
    const projects = [
      createMockProject({ id: "-Users-foo-code-bar", sessionCount: 3 }),
      createMockProject({ id: "-Users-foo-code-baz", sessionCount: 1 }),
    ];

    const deps = createMockDeps({
      scanner: {
        scanProjects: async () => projects,
        scanSessions: async () => [],
        groupProjects: () => [],
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/directories");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ directories: projects });
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

describe("POST /api/sessions/:sessionId/message", () => {
  test("returns 200 with sessionId on success", async () => {
    let receivedId = "";
    let receivedMessage = "";

    const deps = createMockDeps({
      controller: {
        startSession: async () => ({ ok: true, sessionId: "" }),
        stopSession: async () => ({ ok: true, sessionId: "" }),
        resumeSession: async () => ({ ok: true, sessionId: "" }),
        sendMessage: async (id, message) => {
          receivedId = id;
          receivedMessage = message;
          return { ok: true, sessionId: id };
        },
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/sessions/sess-abc-123/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello world" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sessionId: "sess-abc-123" });
    expect(receivedId).toBe("sess-abc-123");
    expect(receivedMessage).toBe("hello world");
  });

  test("returns 400 when message is missing", async () => {
    const deps = createMockDeps();
    const app = createApp(deps);
    const res = await app.request("/api/sessions/sess-abc-123/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "message is required" });
  });

  test("returns 500 when controller fails", async () => {
    const deps = createMockDeps({
      controller: {
        startSession: async () => ({ ok: true, sessionId: "" }),
        stopSession: async () => ({ ok: true, sessionId: "" }),
        resumeSession: async () => ({ ok: true, sessionId: "" }),
        sendMessage: async () => ({
          ok: false,
          sessionId: "",
          error: "session not active",
        }),
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/sessions/sess-abc-123/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "session not active" });
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

describe("Global error handling", () => {
  test("returns 500 with opaque error when scanner throws", async () => {
    const deps = createMockDeps({
      scanner: {
        scanProjects: async () => {
          throw new Error("database connection failed");
        },
        scanSessions: async () => [],
        groupProjects: () => [],
      },
    });

    const app = createApp(deps);
    const res = await app.request("/api/projects");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("database");
  });

  test("returns 400 for invalid JSON body", async () => {
    const deps = createMockDeps();
    const app = createApp(deps);
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Invalid JSON" });
  });

  test("returns 404 for unmatched API route", async () => {
    const deps = createMockDeps();
    const app = createApp(deps);
    const res = await app.request("/api/nonexistent/route");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
  });
});

describe("GET /api/projects/:slug/sessions", () => {
  test("returns 200 with sessions array for grouped project", async () => {
    const sessions = [
      createMockSession({ sessionId: "sess-1" }),
      createMockSession({ sessionId: "sess-2" }),
    ];
    const receivedDirs: string[] = [];

    const deps = createMockDeps({
      basePaths: [join(FIXTURES, "resolve-base-1")],
      preferences: {
        readPreferences: async () => ({
          projects: [
            {
              title: "project-alpha",
              projectDirs: ["-Users-project-alpha"],
            },
          ],
        }),
        writePreferences: async () => {},
      },
      scanner: {
        scanProjects: async () => [],
        scanSessions: async (dir) => {
          receivedDirs.push(dir);
          return sessions;
        },
        groupProjects: () => [],
      },
    });

    const app = createApp(deps);
    const res = await app.request(
      "/api/projects/project-alpha/sessions",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body.sessions).toHaveLength(2);
  });

  test("returns 404 when slug not found in preferences", async () => {
    const deps = createMockDeps({
      basePaths: [join(FIXTURES, "resolve-base-1")],
    });

    const app = createApp(deps);
    const res = await app.request(
      "/api/projects/nonexistent-slug/sessions",
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Project not found" });
  });
});

describe("Static file serving", () => {
  const STATIC_DIR = join(FIXTURES, "static");

  test("serves static file with correct Content-Type", async () => {
    const deps = createMockDeps({ staticDir: STATIC_DIR });
    const app = createApp(deps);
    const res = await app.request("/style.css");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    const text = await res.text();
    expect(text).toContain("body");
  });

  test("SPA fallback serves index.html for non-existent paths", async () => {
    const deps = createMockDeps({ staticDir: STATIC_DIR });
    const app = createApp(deps);
    const res = await app.request("/nonexistent/deep/path");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const text = await res.text();
    expect(text).toContain("Hello Fleet");
  });

  test("sets no-cache for index.html", async () => {
    const deps = createMockDeps({ staticDir: STATIC_DIR });
    const app = createApp(deps);
    const res = await app.request("/index.html");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  test("sets immutable cache for hashed assets", async () => {
    const deps = createMockDeps({ staticDir: STATIC_DIR });
    const app = createApp(deps);
    const res = await app.request("/assets/app.a1b2c3d4.js");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  test("sets 1-day cache for other static files", async () => {
    const deps = createMockDeps({ staticDir: STATIC_DIR });
    const app = createApp(deps);
    const res = await app.request("/style.css");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  test("API routes take priority over static files", async () => {
    const grouped: GroupedProject[] = [
      {
        slug: "test-project",
        title: "test-project",
        projectDirs: ["test-project"],
        matchedDirIds: ["test-project"],
        sessionCount: 0,
        lastActiveAt: null,
      },
    ];
    const deps = createMockDeps({
      staticDir: STATIC_DIR,
      scanner: {
        scanProjects: async () => [],
        scanSessions: async () => [],
        groupProjects: () => grouped,
      },
    });
    const app = createApp(deps);
    const res = await app.request("/api/projects");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ projects: grouped });
  });
});
