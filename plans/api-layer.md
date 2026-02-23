# Implementation Plan: API Layer

> Source: `specs/api-layer.md`
> Generated: 2026-02-22

---

## Phase 0 — Tracer Bullet
> Minimal Hono app with dependency injection, one read route (GET /api/projects), and one test proving the wiring works end-to-end.

### Scaffold + GET /api/projects
- [x] Add `hono` to `package.json` dependencies and install
- [x] Create `src/api/types.ts` — define `AppDependencies`, `ControlResult`, `StartSessionOpts` interfaces
- [x] Create `src/api/create-app.ts` — `createApp(deps: AppDependencies)` returning a Hono instance with `GET /api/projects` that delegates to `deps.scanner.scanProjects(deps.basePaths)` and returns `{ projects: [...] }`
- [x] Create `src/api/index.ts` — re-export `createApp` and types
- [x] Create `src/api/__tests__/helpers.ts` — factory functions for mock `AppDependencies` (fake scanner, parser, controller)
- [x] Create `src/api/__tests__/create-app.test.ts` — test `GET /api/projects` returns 200 with correct shape using `app.request()` (Hono test utility, no real server)

---

## Phase 1 — Read Routes + File Resolution

### File Resolution Helpers
- [x] Create `src/api/resolve.ts` — `resolveProjectDir(basePaths, projectId)` scanning each basePath for a matching directory
- [x] Add `resolveSessionFile(basePaths, sessionId)` scanning basePath/*/sessionId.jsonl
- [x] Create `src/api/__tests__/resolve.test.ts` — test both resolvers with fixture directories (first-match wins, returns null when missing)

### GET /api/projects/:projectId/sessions
- [x] Add route in `create-app.ts` — resolve projectId via `resolveProjectDir`, delegate to `scanner.scanSessions`, return `{ sessions: [...] }`
- [x] Return 404 `{ "error": "Project not found" }` when resolution returns null
- [x] Add tests: happy path (200), project not found (404)

### GET /api/sessions/:sessionId
- [x] Add route in `create-app.ts` — resolve sessionId via `resolveSessionFile`, read file with `Bun.file().text()`, delegate to `parser.parseFullSession`, return `{ session: {...} }`
- [x] Return 404 `{ "error": "Session not found" }` when resolution returns null
- [x] Add tests: happy path (200), session not found (404)

---

## Phase 2 — Control Routes

### POST /api/sessions (start)
- [x] Add route — parse JSON body, validate `projectDir` required, delegate to `controller.startSession`, return 201 on success
- [x] Return 400 `{ "error": "projectDir is required" }` when missing
- [x] Return 500 with controller error when `ok: false`
- [x] Add tests: happy path (201), missing projectDir (400), controller failure (500)

### POST /api/sessions/:sessionId/stop
- [ ] Add route — delegate to `controller.stopSession(sessionId)`, return 200 on success, 500 on failure
- [ ] Add tests: happy path (200), controller failure (500)

### POST /api/sessions/:sessionId/resume
- [ ] Add route — delegate to `controller.resumeSession(sessionId)`, return 200 on success, 500 on failure
- [ ] Add tests: happy path (200), controller failure (500)

### POST /api/sessions/:sessionId/message
- [ ] Add route — parse JSON body, validate `message` required, delegate to `controller.sendMessage`, return 200
- [ ] Return 400 `{ "error": "message is required" }` when missing
- [ ] Add tests: happy path (200), missing message (400), controller failure (500)

---

## Phase 3 — Middleware + Error Handling

### Request Logging Middleware
- [ ] Add Hono middleware in `create-app.ts` — log `METHOD /path STATUS DURATIONms` for every request (info for 2xx, warn for 4xx, error for 5xx)

### Global Error Handling
- [ ] Add Hono `onError` handler — catch thrown errors, return 500 `{ "error": "Internal server error" }` (no stack traces or internal details in response)
- [ ] Add 404 catch-all for unmatched `/api/*` routes — return 404 `{ "error": "Not found" }`
- [ ] Handle invalid JSON body — return 400 `{ "error": "Invalid JSON" }`
- [ ] Add tests: scanner throws (500 opaque), invalid JSON body (400), unmatched API route (404)

### Static File Serving
- [ ] Add static file middleware in `create-app.ts` (only when `staticDir` is non-null), registered after API routes
- [ ] Serve files from `staticDir` with correct Content-Type
- [ ] SPA fallback: serve `staticDir/index.html` for non-file paths
- [ ] Cache headers: `no-cache` for `index.html`, `public, max-age=31536000, immutable` for hashed assets, `public, max-age=86400` for other files
- [ ] Add tests: serves static file, SPA fallback to index.html, cache headers per file type, API routes take priority over static files
