# API Module

HTTP API layer for the Fleet controller.

## Public Interface

### Functions

- **`createApp(deps: AppDependencies)`** — Creates a Hono application with all REST endpoints and middleware.
- **`createServer(app): ServerOptions`** — Creates a Bun-compatible server config with HTTP routing.
- **`resolveProjectDir(projectId, basePaths): Promise<string | null>`** — Resolves a project ID to its directory path.
- **`resolveSessionFile(sessionId, projectDir): Promise<string | null>`** — Resolves a session ID to its `.jsonl` file path.
- **`createResolveSessionPath(basePaths): (sessionId) => Promise<string | null>`** — Returns a pre-configured session path resolver.

### Types

- **`AppDependencies`** — All dependencies required to create the app (scanner, parser, controller, config, transport, basePaths, staticDir).
- **`ServerOptions`** — Bun server config with `fetch` handler.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects, grouped by config |
| GET | `/api/projects/:slug/sessions` | List sessions for a project group (optional `?limit=`) |
| GET | `/api/projects/:slug/worktrees` | List git worktrees for a project group |
| GET | `/api/directories` | Raw directory scan across all base paths |
| GET | `/api/config` | Read fleet configuration |
| PUT | `/api/config` | Update fleet configuration |
| POST | `/api/sessions` | Create a new session (`projectDir`, optional `prompt`/`cwd`) |
| GET | `/api/sessions/:sessionId` | Fetch and parse a full session transcript |
| POST | `/api/sessions/:sessionId/stop` | Stop an active session |
| POST | `/api/sessions/:sessionId/resume` | Resume a stopped session |
| POST | `/api/sessions/:sessionId/message` | Send a message to an active session |
