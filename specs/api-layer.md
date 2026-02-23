# API Layer

Serves request/response HTTP endpoints for project browsing, session retrieval, and session control. Built with Hono on Bun. Delegates to the Project Scanner for listing, the Transcript Parser for full session parsing, and the Session Controller for lifecycle operations. Serves static assets in production. For system context, see [ARCHITECTURE.md](../ARCHITECTURE.md). For the data it returns, see [project-scanner.md](project-scanner.md) and [transcript-parser.md](transcript-parser.md).

## Where It Fits

```
+-------------------+         +-------------------+
|  Client App (UI)  |         |  Static Assets    |
+--------+----------+         |  (dist/)          |
         |                    +--------+----------+
         |  HTTP requests                |
         v                               |
+--------+-------------------------------+--------+
|                     API Layer (Hono)             |
|                                                  |
|  GET  /api/projects                              |
|  GET  /api/projects/:projectId/sessions          |
|  GET  /api/sessions/:sessionId                   |
|  POST /api/sessions                              |
|  POST /api/sessions/:sessionId/stop              |
|  POST /api/sessions/:sessionId/resume            |
|  POST /api/sessions/:sessionId/message           |
|  GET  /*  (static files + SPA fallback)          |
+---+----------------+----------------+-----------+
    |                |                |
    v                v                v
+--------+   +------+------+   +-----+----------+
| Scanner |   |   Parser    |   |  Controller    |
+--------+   +-------------+   +----------------+
```

## Dependencies

The API layer imports three modules. Each is injected at server creation time so tests can substitute fakes.

```
createApp(deps: AppDependencies) -> Hono
```

### `AppDependencies`

```
{
  scanner: {
    scanProjects:  (basePaths: string[]) -> Promise<ProjectSummary[]>
    scanSessions:  (projectDir: string)  -> Promise<SessionSummary[]>
  }
  parser: {
    parseFullSession: (content: string) -> EnrichedSession
  }
  controller: {
    startSession:   (opts: StartSessionOpts)   -> Promise<ControlResult>
    stopSession:    (sessionId: string)         -> Promise<ControlResult>
    resumeSession:  (sessionId: string)         -> Promise<ControlResult>
    sendMessage:    (sessionId: string, message: string) -> Promise<ControlResult>
  }
  basePaths:   string[]       // transcript store base paths, default ["~/.claude/projects/"]
  staticDir:   string | null  // path to static assets, null disables static serving
}
```

`createApp` returns a configured Hono instance. The caller (the server entry point) is responsible for calling `Bun.serve()` with the Hono fetch handler. This keeps the API layer testable without starting a real server.

### `ControlResult`

The Session Controller returns a uniform result for all control operations:

```
{
  ok:         boolean
  sessionId:  string
  error?:     string    // present when ok is false
}
```

### `StartSessionOpts`

```
{
  projectDir:  string            // which project to start the session in
  prompt?:     string            // optional initial prompt
  cwd?:        string            // working directory override
}
```

## Routes

### `GET /api/projects`

Lists all projects across configured base paths.

**Delegates to:** `scanner.scanProjects(basePaths)`

**Response 200:**

```json
{
  "projects": [
    {
      "id": "-Users-foo-code-bar",
      "source": "/Users/foo/.claude/projects/",
      "path": "/Users/foo/code/bar",
      "sessionCount": 12,
      "lastActiveAt": "2026-02-22T10:30:00.000Z"
    }
  ]
}
```

The array is pre-sorted by `lastActiveAt` descending (the scanner's default). The API does not re-sort.

### `GET /api/projects/:projectId/sessions`

Lists sessions for a single project.

**Parameters:**
- `projectId` — URL-encoded raw directory name (e.g., `-Users-foo-code-bar`)

**Resolution:** The API resolves `projectId` to a filesystem path by scanning `basePaths` for a directory matching the given ID. If no matching directory is found, returns 404.

**Delegates to:** `scanner.scanSessions(resolvedProjectDir)`

**Response 200:**

```json
{
  "sessions": [
    {
      "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "firstPrompt": "Read my README",
      "model": "claude-opus-4-6",
      "startedAt": "2026-02-22T09:00:00.000Z",
      "lastActiveAt": "2026-02-22T10:30:00.000Z",
      "cwd": "/Users/foo/code/bar",
      "gitBranch": "main",
      "inputTokens": 15000,
      "outputTokens": 8000,
      "cacheCreationInputTokens": 5000,
      "cacheReadInputTokens": 12000,
      "cost": 0.42
    }
  ]
}
```

**Response 404:**

```json
{ "error": "Project not found" }
```

### `GET /api/sessions/:sessionId`

Returns a fully enriched session.

**Parameters:**
- `sessionId` — UUID of the session

**Resolution:** The API locates the session file by scanning `basePaths` for `*/{sessionId}.jsonl`. If no file is found, returns 404. Reads the file contents and delegates to the parser.

**Delegates to:** `parser.parseFullSession(fileContents)`

**Response 200:**

```json
{
  "session": {
    "messages": [],
    "turns": [],
    "responses": [],
    "toolCalls": [],
    "totals": {
      "inputTokens": 15000,
      "outputTokens": 8000,
      "cacheCreationInputTokens": 5000,
      "cacheReadInputTokens": 12000,
      "totalTokens": 40000,
      "estimatedCostUsd": 0.42,
      "toolUseCount": 7
    },
    "toolStats": [],
    "subagents": [],
    "contextSnapshots": []
  }
}
```

The full `EnrichedSession` shape is defined in [transcript-parser.md](transcript-parser.md). The API serializes it as-is — no transformation, no field omission.

**Response 404:**

```json
{ "error": "Session not found" }
```

### `POST /api/sessions`

Starts a new session.

**Request body:**

```json
{
  "projectDir": "-Users-foo-code-bar",
  "prompt": "Help me refactor the auth module",
  "cwd": "/Users/foo/code/bar"
}
```

`prompt` and `cwd` are optional. `projectDir` is required.

**Delegates to:** `controller.startSession(opts)`

**Response 201:**

```json
{
  "ok": true,
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Response 400** (missing `projectDir`):

```json
{ "error": "projectDir is required" }
```

**Response 500** (controller failure):

```json
{
  "ok": false,
  "error": "Failed to spawn CLI process"
}
```

### `POST /api/sessions/:sessionId/stop`

Stops a running session.

**Parameters:**
- `sessionId` — UUID of the session

**Request body:** None.

**Delegates to:** `controller.stopSession(sessionId)`

**Response 200:**

```json
{ "ok": true, "sessionId": "a1b2c3d4-..." }
```

**Response 500** (controller failure):

```json
{ "ok": false, "error": "Session not running" }
```

### `POST /api/sessions/:sessionId/resume`

Resumes a stopped session.

**Parameters:**
- `sessionId` — UUID of the session

**Request body:** None.

**Delegates to:** `controller.resumeSession(sessionId)`

**Response 200:**

```json
{ "ok": true, "sessionId": "a1b2c3d4-..." }
```

**Response 500** (controller failure):

```json
{ "ok": false, "error": "Session not found or already running" }
```

### `POST /api/sessions/:sessionId/message`

Sends a message to a running session.

**Parameters:**
- `sessionId` — UUID of the session

**Request body:**

```json
{
  "message": "Now add tests for the auth module"
}
```

`message` is required.

**Delegates to:** `controller.sendMessage(sessionId, message)`

**Response 200:**

```json
{ "ok": true, "sessionId": "a1b2c3d4-..." }
```

**Response 400** (missing `message`):

```json
{ "error": "message is required" }
```

**Response 500** (controller failure):

```json
{ "ok": false, "error": "Session not running" }
```

## Static Asset Serving

When `staticDir` is non-null, the API serves static files for the client application. This is the production mode — in development, the client dev server handles its own assets.

### Behavior

```
for each request not matching /api/*:
  filePath = staticDir + request.pathname
  if file exists at filePath:
    serve file with appropriate Content-Type
  else:
    serve staticDir/index.html          (SPA fallback)
```

### Cache Headers

| File type | Cache-Control | Rationale |
|-----------|--------------|-----------|
| `index.html` | `no-cache` | Must always fetch fresh to pick up new deploys |
| Hashed assets (`*.{js,css}` with content hash in filename) | `public, max-age=31536000, immutable` | Hash changes on content change; safe to cache forever |
| Other static files (images, fonts) | `public, max-age=86400` | Cache for a day; reasonable for infrequently changing assets |

Static file serving is registered *after* API routes so `/api/*` routes always take priority.

## File Resolution

Two routes need to locate files on disk: session listing (needs the project directory) and session detail (needs the JSONL file). Both use the same resolution strategy.

### Project Resolution

```
resolveProjectDir(basePaths: string[], projectId: string) -> string | null

for each basePath in basePaths:
  candidate = join(basePath, projectId)
  if candidate is a directory:
    return candidate
return null
```

Returns the first match. If the same `projectId` exists under multiple base paths, the first base path wins. This is consistent with the scanner's merge order.

### Session File Resolution

```
resolveSessionFile(basePaths: string[], sessionId: string) -> string | null

for each basePath in basePaths:
  for each projectDir in basePath:
    candidate = join(projectDir, sessionId + ".jsonl")
    if candidate exists:
      return candidate
return null
```

This is a linear scan. For the expected scale (tens of projects, hundreds of sessions), this is fast enough. If it becomes a bottleneck, the scanner can maintain an in-memory index — but that optimization is out of scope for this spec.

## Error Handling

The API layer uses a Hono error-handling middleware that catches thrown errors and returns structured JSON responses.

| Scenario | HTTP Status | Response |
|----------|-------------|----------|
| Route not matched under `/api/*` | 404 | `{ "error": "Not found" }` |
| Missing required body field | 400 | `{ "error": "<field> is required" }` |
| Invalid JSON body | 400 | `{ "error": "Invalid JSON" }` |
| Project not found (resolution returns null) | 404 | `{ "error": "Project not found" }` |
| Session file not found (resolution returns null) | 404 | `{ "error": "Session not found" }` |
| Controller returns `{ ok: false }` | 500 | `{ "ok": false, "error": "<controller error>" }` |
| Scanner throws | 500 | `{ "error": "Internal server error" }` |
| Parser throws (malformed file) | 500 | `{ "error": "Internal server error" }` |
| File read fails (permissions, I/O) | 500 | `{ "error": "Internal server error" }` |

All error responses have `Content-Type: application/json`. Internal error details (stack traces, paths) are logged but never exposed in the response body.

### Response Envelope

All successful API responses wrap their payload in a named key (`projects`, `sessions`, `session`, or the `ControlResult` fields directly). This makes the response self-describing and extensible — metadata fields can be added alongside the payload without breaking clients.

All error responses use `{ "error": string }`. Control endpoints additionally include `{ "ok": false }` to distinguish controller errors from API errors.

## Middleware

### JSON Content-Type

All `/api/*` responses set `Content-Type: application/json`. Hono's `c.json()` handles this automatically.

### Request Logging

Every request is logged with: method, path, status code, and duration in milliseconds. Format:

```
GET /api/projects 200 12ms
POST /api/sessions/abc/stop 500 3ms
```

Logged at `info` level for 2xx, `warn` for 4xx, `error` for 5xx.

### CORS

Not required. Fleet runs as a local tool — the API and client are served from the same origin in production. In development, the client dev server proxies API requests. If cross-origin access is ever needed, CORS middleware can be added to Hono with a one-liner.

## Concrete Example

A user opens the Fleet dashboard and navigates to a session.

**Step 1: Dashboard loads, fetches project list**

```
GET /api/projects

→ scanner.scanProjects(["~/.claude/projects/"])
← 200 {
    "projects": [
      { "id": "-Users-foo-code-bar", "path": "/Users/foo/code/bar", "sessionCount": 3, ... },
      { "id": "-Users-foo-code-baz", "path": "/Users/foo/code/baz", "sessionCount": 1, ... }
    ]
  }
```

**Step 2: User clicks a project, fetches sessions**

```
GET /api/projects/-Users-foo-code-bar/sessions

→ resolveProjectDir → "/Users/foo/.claude/projects/-Users-foo-code-bar"
→ scanner.scanSessions("/Users/foo/.claude/projects/-Users-foo-code-bar")
← 200 {
    "sessions": [
      { "sessionId": "abc-123", "firstPrompt": "Read my README", "cost": 0.42, ... },
      { "sessionId": "def-456", "firstPrompt": "Fix the auth bug", "cost": 0.18, ... }
    ]
  }
```

**Step 3: User clicks a session, fetches full enriched data**

```
GET /api/sessions/abc-123

→ resolveSessionFile → "/Users/foo/.claude/projects/-Users-foo-code-bar/abc-123.jsonl"
→ Bun.file(path).text()
→ parser.parseFullSession(content)
← 200 {
    "session": {
      "messages": [...],
      "turns": [{ "promptText": "Read my README", "responseCount": 2, ... }],
      "totals": { "inputTokens": 15000, "outputTokens": 8000, "estimatedCostUsd": 0.42, ... },
      ...
    }
  }
```

**Step 4: User sends a message to the running session**

```
POST /api/sessions/abc-123/message
Content-Type: application/json
{ "message": "Now add tests" }

→ controller.sendMessage("abc-123", "Now add tests")
← 200 { "ok": true, "sessionId": "abc-123" }
```

The controller writes to the CLI subprocess's stdin. The CLI processes the message, appends new records to the JSONL file, and the File Watcher picks them up for real-time delivery.

## Verification

1. **Project listing.** Given 3 project directories with known sessions, `GET /api/projects` returns exactly 3 projects with correct `sessionCount` and `lastActiveAt` values. Response is sorted by `lastActiveAt` descending.

2. **Session listing.** Given a project with 5 sessions, `GET /api/projects/:projectId/sessions` returns exactly 5 session summaries with correct token totals and cost. Response is sorted by `lastActiveAt` descending.

3. **Session detail.** `GET /api/sessions/:sessionId` returns an `EnrichedSession` that matches calling `parseFullSession` directly on the same file. Every field is present and identical.

4. **Project not found.** `GET /api/projects/nonexistent/sessions` returns 404 with `{ "error": "Project not found" }`.

5. **Session not found.** `GET /api/sessions/nonexistent-uuid` returns 404 with `{ "error": "Session not found" }`.

6. **Start session.** `POST /api/sessions` with valid `projectDir` returns 201 with `{ "ok": true, "sessionId": "..." }`. The controller's `startSession` is called with the correct options.

7. **Start session validation.** `POST /api/sessions` without `projectDir` returns 400 with `{ "error": "projectDir is required" }`. The controller is not called.

8. **Stop session.** `POST /api/sessions/:sessionId/stop` calls `controller.stopSession` and returns 200 with the controller's result.

9. **Resume session.** `POST /api/sessions/:sessionId/resume` calls `controller.resumeSession` and returns 200 with the controller's result.

10. **Send message.** `POST /api/sessions/:sessionId/message` with `{ "message": "..." }` calls `controller.sendMessage` and returns 200.

11. **Send message validation.** `POST /api/sessions/:sessionId/message` without `message` returns 400. The controller is not called.

12. **Controller error propagation.** When the controller returns `{ ok: false, error: "..." }`, the API returns 500 with the same error.

13. **Invalid JSON body.** `POST /api/sessions` with non-JSON body returns 400 with `{ "error": "Invalid JSON" }`.

14. **Static file serving.** With `staticDir` configured, `GET /style.css` serves the file from `staticDir/style.css`. `GET /nonexistent/path` serves `staticDir/index.html` (SPA fallback).

15. **Static cache headers.** `GET /index.html` has `Cache-Control: no-cache`. `GET /assets/app.abc123.js` has `Cache-Control: public, max-age=31536000, immutable`.

16. **API routes take priority.** `GET /api/projects` returns JSON even when `staticDir` is configured and a file at `staticDir/api/projects` exists.

17. **Dependency injection.** `createApp` called with mock scanner, parser, and controller functions correctly. The mocks receive the expected arguments and their return values appear in the HTTP responses.

18. **Internal errors are opaque.** When the scanner throws an exception, the API returns 500 with `{ "error": "Internal server error" }` — the exception message and stack trace do not appear in the response body.
