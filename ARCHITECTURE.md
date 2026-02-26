# Architecture

Fleet is a real-time dashboard for monitoring Claude Code sessions. It reads the CLI's append-only JSONL transcript files from disk and presents a live web interface. See [Glossary](docs/GLOSSARY.md) for term definitions.

## Components

**Project Scanner** — Traverses the transcript directory to enumerate projects and sessions, returning summary metadata sorted by recency. [Spec](specs/project-scanner.md)

**Transcript Parser** — Full-parses a session JSONL file into an enriched, type-checked structure with turns, tool stats, cost, and context window snapshots. [Spec](specs/transcript-parser.md)

**File Watcher** — Tails transcript files by byte offset, debounces new lines, and emits batches of parsed messages to listeners.

**API Layer** — REST endpoints for listing projects/sessions, fetching enriched session data, and proxying session control commands. Serves the client's static assets in production.

**Real-time Transport** — Persistent bidirectional connections that relay live watcher events to subscribed clients and broadcast session lifecycle changes.

**Client Application** — React SPA for browsing projects, viewing sessions with syntax-highlighted messages and analytics panels, and controlling sessions (start/stop/resume/send).

## Data Flow

Full session load: Client → API → Transcript Parser → Client

Live updates: CLI writes → File Watcher → Parser → Real-time Transport → Client

For sequence diagrams, see [/docs/data-flow.md](/docs/data-flow.md)
