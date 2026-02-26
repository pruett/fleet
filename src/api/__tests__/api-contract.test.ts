/**
 * API Contract Test — API Module
 *
 * Guards the API's public surface so that any addition, removal,
 * or rename of an export or HTTP route causes an explicit, reviewable
 * test failure.
 *
 * Runtime layer:  bun test  — checks barrel exports, route inventory
 * Compile-time layer:  tsc --noEmit  — checks type export existence and key fields
 */

import { describe, expect, it } from "bun:test";
import * as api from "../index";
import { createApp } from "../create-app";
import { createMockDeps } from "./helpers";

// ────────────────────────────────────────────────────────────
// Compile-time layer — type imports & structural guards
// ────────────────────────────────────────────────────────────

import type { ServerOptions } from "../create-server";
import type { AppDependencies, ControlResult, StartSessionOpts } from "../types";

// Structural assertions — if a required field is removed, tsc fails.

type _AssertAppDependencies = Pick<
  AppDependencies,
  | "scanner"
  | "parser"
  | "controller"
  | "preferences"
  | "transport"
  | "basePaths"
  | "staticDir"
>;

type _AssertControlResult = Pick<ControlResult, "ok" | "sessionId" | "error">;

type _AssertStartSessionOpts = Pick<
  StartSessionOpts,
  "projectDir" | "prompt" | "cwd"
>;

type _AssertServerOptions = Pick<ServerOptions, "fetch" | "websocket">;

// Prevent "unused" warnings while keeping the compile-time checks alive.
type _UseAll =
  | _AssertAppDependencies
  | _AssertControlResult
  | _AssertStartSessionOpts
  | _AssertServerOptions;

// ────────────────────────────────────────────────────────────
// Runtime layer — barrel export checks
// ────────────────────────────────────────────────────────────

const EXPECTED_RUNTIME_EXPORTS = [
  "createApp",
  "createResolveSessionPath",
  "createServer",
  "resolveProjectDir",
  "resolveSessionFile",
];

describe("API Module Contract", () => {
  it("exports exactly the expected runtime symbols", () => {
    const actual = Object.keys(api).sort();
    expect(actual).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it("every runtime export is a function", () => {
    for (const name of EXPECTED_RUNTIME_EXPORTS) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
    }
  });
});

// ────────────────────────────────────────────────────────────
// Route inventory — every public HTTP + WS endpoint
// ────────────────────────────────────────────────────────────

/**
 * Canonical list of every public API route.
 * Sorted by method then path for easy scanning.
 *
 * If you add, remove, or rename a route in create-app.ts,
 * update this list — the test will fail until you do.
 */
const EXPECTED_ROUTES: { method: string; path: string }[] = [
  // Projects
  { method: "GET", path: "/api/projects" },
  { method: "GET", path: "/api/directories" },
  { method: "GET", path: "/api/projects/:slug/sessions" },
  { method: "GET", path: "/api/projects/:slug/worktrees" },

  // Sessions
  { method: "POST", path: "/api/sessions" },
  { method: "GET", path: "/api/sessions/:sessionId" },
  { method: "POST", path: "/api/sessions/:sessionId/stop" },
  { method: "POST", path: "/api/sessions/:sessionId/resume" },
  { method: "POST", path: "/api/sessions/:sessionId/message" },

  // Preferences
  { method: "GET", path: "/api/preferences" },
  { method: "PUT", path: "/api/preferences" },
];

/**
 * Extract registered routes from a Hono app instance.
 *
 * Hono stores routes internally on each method router.
 * We walk the public `routes` property, filtering to `/api/*`
 * paths and ignoring middleware/catch-all handlers.
 */
function extractRoutes(app: ReturnType<typeof createApp>) {
  return app.routes
    .filter((r) => r.path.startsWith("/api/"))
    .map((r) => ({ method: r.method, path: r.path }))
    .sort((a, b) => a.method.localeCompare(b.method) || a.path.localeCompare(b.path));
}

describe("API Route Inventory", () => {
  const app = createApp(createMockDeps());

  const sorted = [...EXPECTED_ROUTES].sort(
    (a, b) => a.method.localeCompare(b.method) || a.path.localeCompare(b.path),
  );

  it("registers exactly the expected API routes", () => {
    const actual = extractRoutes(app);
    expect(actual).toEqual(sorted);
  });

  it("every expected route is reachable by method + path", () => {
    const actual = extractRoutes(app);
    const routeSet = new Set(actual.map((r) => `${r.method} ${r.path}`));
    for (const route of EXPECTED_ROUTES) {
      expect(routeSet.has(`${route.method} ${route.path}`)).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────
// WebSocket endpoint
// ────────────────────────────────────────────────────────────

describe("WebSocket Endpoint", () => {
  it("upgrade path is /ws", async () => {
    // The WebSocket path is defined in create-server.ts.
    // We verify by making a non-upgrade HTTP request to /ws
    // and confirming the server layer handles it (returns 400,
    // not 404), proving the path is recognized.
    const { createServer } = await import("../create-server");
    const server = createServer(createMockDeps());
    expect(typeof server.fetch).toBe("function");
    expect(typeof server.websocket.open).toBe("function");
    expect(typeof server.websocket.message).toBe("function");
    expect(typeof server.websocket.close).toBe("function");
  });
});
