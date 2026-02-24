# Fleet

Real-time monitoring dashboard for Claude Code sessions.

## Prerequisites

- [Bun](https://bun.sh) >= 1.1

## Setup

```sh
bun install
```

## Development

```sh
bun dev
```

This starts two processes concurrently:

- **Server** (`bun --watch src/main.ts`) — API + WebSocket on `http://localhost:3000`, auto-restarts on file changes
- **Client** (Vite) — React dev server on `http://localhost:5173` with HMR, proxies `/api` and `/ws` to the server

## Production

```sh
bun run build   # Build client assets to client/dist/
bun start       # Serve API + static assets on port 3000
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FLEET_PORT` | `3000` | Server listen port |
| `FLEET_BASE_PATHS` | `~/.claude/projects` | Comma-separated paths to scan for Claude session data |
| `FLEET_STATIC_DIR` | `null` (dev) / `client/dist` (production) | Directory to serve static files from |

## Project Structure

```
fleet/
├── src/                  # Server (Bun + Hono)
│   ├── main.ts           # Entry point — DI wiring + Bun.serve()
│   ├── api/              # HTTP routes and server config
│   ├── parser/           # JSONL session transcript parser
│   ├── scanner/          # Project/session filesystem scanner
│   ├── transport/        # WebSocket real-time transport
│   └── watcher/          # File watcher for live session tailing
├── client/               # React dashboard (Vite + Tailwind)
│   ├── src/
│   └── package.json      # @fleet/client workspace
├── scripts/
│   └── dev.ts            # Concurrent dev launcher
├── package.json          # Workspace root + server package
└── tsconfig.json         # Server TypeScript config
```

## Testing

```sh
bun test              # Run server tests
bun run typecheck     # Type-check server + client
```
