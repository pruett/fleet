# Implementation Plan: Client Application

> Source: `specs/client-application.md`
> Generated: 2026-02-23

---

## Phase 0 — Tracer Bullet(s)
> Two tracer bullets: one for REST data display (scaffold → fetch → render), one for WebSocket live updates (connect → subscribe → stream).

### REST Tracer: Scaffold → Project List → Session View

- [x] Run `bunx --bun shadcn@latest create` with the spec's preset URL and `--template vite` to scaffold the client app into `client/` at the project root
- [x] Verify scaffold output: `tailwind.config.ts`, `components.json`, `tsconfig.json` with `@/` alias, Vite config, Geist font, CSS variable theme
- [x] Configure Vite dev server proxy: `/api/*` → Hono server, `/ws` → Hono server (in `client/vite.config.ts`)
- [x] Add shadcn/ui components needed for tracer: `bunx --bun shadcn@latest add card badge`
- [x] Create shared type re-exports (`client/src/types/api.ts`) — import `ProjectSummary`, `SessionSummary`, `EnrichedSession`, `ParsedMessage` types from server source or duplicate minimal type definitions
- [x] Create a minimal API client module (`client/src/lib/api.ts`) with `fetchProjects()`, `fetchSessions(projectId)`, `fetchSession(sessionId)` wrapping `fetch` calls to `/api/*` endpoints
- [x] Build `ProjectListView` (`client/src/views/ProjectListView.tsx`) — fetch projects on mount, render each as a `Card` with decoded path, session count, relative timestamp; clicking navigates to session list
- [x] Build `SessionListView` (`client/src/views/SessionListView.tsx`) — fetch sessions on mount, render each as a `Card` with first prompt, model, cost, tokens; clicking navigates to session view
- [x] Build a minimal `SessionView` (`client/src/views/SessionView.tsx`) — fetch `EnrichedSession`, render messages as a flat list (plain text, no styling yet)
- [x] Wire up minimal client-side routing (`client/src/App.tsx`) — hash or path-based routing for `/`, `/project/:projectId`, `/session/:sessionId`
- [ ] Verify end-to-end: start Hono server, start Vite dev server, open browser, see projects, click through to a session's messages

### WebSocket Tracer: Connect → Subscribe → Stream

- [x] Create WebSocket client module (`client/src/lib/ws.ts`) — connect to `/ws`, expose `subscribe(sessionId)`, `unsubscribe()`, and an `onMessage` callback
- [x] Integrate WS into `SessionView` — after REST fetch completes, subscribe to the session; on incoming `messages` batch, append to local state and re-render
- [ ] Verify end-to-end: open a session in the browser, append a line to the transcript file, see the new message appear in the UI without refresh

---

## Phase 1 — Core Views & Navigation

### Client-Side Router
- [x] Install and configure React Router (or implement a minimal router) with routes: `/`, `/project/:projectId`, `/session/:sessionId`
- [x] Support browser back/forward navigation and deep links (opening `/session/abc-123` directly works)
- [x] Add `Breadcrumb` component (shadcn/ui) for back navigation in `SessionListView` and `SessionView`

### ProjectListView (Full)
- [x] Sort by `lastActiveAt` descending (server-provided order)
- [x] Format `lastActiveAt` as relative time (e.g., "3 minutes ago")
- [x] Add empty state: "No projects found" with hint about expected transcript directory
- [x] Add `j`/`k` keyboard navigation and `Enter` to select (basic list selection)

### SessionListView (Full)
- [x] Render all summary fields: first prompt (truncated ~100 chars), model, cost (USD), token count (formatted with commas), started/last active (relative), git branch
- [x] Add empty state for projects with zero sessions
- [x] Back link/breadcrumb to project list

### SessionView Layout
- [x] Implement two-column layout: conversation panel (left), analytics panel (right)
- [x] Make analytics column collapsible (toggle button)
- [x] Add session header with session metadata and status badge placeholder
- [x] Implement load sequence: fetch `EnrichedSession` → render conversation → render analytics → open WS → subscribe
- [x] Implement unload sequence: send `unsubscribe` on navigate away

---

## Phase 2 — Conversation Panel

### Conversation Components (custom — `@ai-sdk/elements` does not exist)
- [x] Build custom `Conversation`, `ConversationScrollButton`, `ConversationEmptyState` components (`client/src/components/conversation/Conversation.tsx`)
- [x] Set up `Conversation`, `ConversationScrollButton`, `ConversationEmptyState` structure in `SessionView`
- [x] Implement auto-scroll behavior: new messages scroll into view, manual scroll-up disengages, scroll button re-engages

### Message Renderers
- [x] Create `MessageComponent` dispatcher (`client/src/components/conversation/MessageComponent.tsx`) that switches on `message.kind`
- [x] `UserPromptBubble` — user bubble with prompt text, skip if `isMeta: true`
- [x] `AssistantTextBlock` — assistant bubble with markdown rendering for fenced code blocks
- [x] `ThinkingBlock` — collapsible "Thinking" block, collapsed by default, monospace text
- [x] `ToolUseBlock` — tool call header with tool name + collapsible JSON input
- [x] `ToolResultBlock` — nested under corresponding `tool_use`, collapsible, collapsed if >= 10 lines, first 5 as preview
- [x] `ApiErrorBlock` — red error banner with error message and retry info
- [x] `TurnDurationBadge` — turn duration badge (e.g., "3.2s")
- [x] `BashProgressBlock` — terminal-style monospace rendering of streaming bash output
- [x] `AgentProgressBlock` — subagent indicator: "Agent started: {prompt}"
- [x] Hidden kinds: `file-history-snapshot`, `queue-operation` — filter out before rendering
- [x] `MalformedBlock` — warning block with raw text, visible only in debug mode

### Turn Grouping
- [x] Group messages by turn: each turn starts at a user prompt and spans until the next
- [x] Add visual separator between turns with turn index label
- [x] Create `TurnGroup` wrapper component

### Collapsible Controls
- [x] Use shadcn/ui `Collapsible` for thinking blocks, tool inputs, tool results
- [x] Implement default collapsed/expanded states per spec
- [x] Add "Expand all" / "Collapse all" toggle at top of conversation panel

---

## Phase 3 — Analytics Panel

### Panel Structure
- [x] Add shadcn/ui `Tabs` for switching between analytics sub-panels
- [x] Create `AnalyticsPanel` container (`client/src/components/analytics/AnalyticsPanel.tsx`)

### Token Usage
- [x] Bar chart or stacked bar showing per-response token breakdown (input, output, cache read, cache creation)
- [x] Summary row with totals from `EnrichedSession.totals`

> **Assumption:** Charts will use a lightweight charting library (e.g., recharts or a minimal SVG-based approach). The spec does not prescribe a specific library.

### Cost
- [x] Cumulative cost line chart over time (one point per response)
- [x] Running total displayed prominently

### Context Window
- [x] Area chart showing context window utilization over session lifetime
- [x] Two series: cumulative input tokens, cumulative output tokens
- [x] Horizontal reference line at model context window limit (if known)

### Tool Statistics
- [x] Table (shadcn/ui `Table`) showing per-tool metrics: tool name, call count, error count, error rate
- [x] Source: `EnrichedSession.toolStats[]`

### Turn Timeline
- [x] Horizontal bar chart showing each turn's duration
- [x] Labels with turn index and truncated prompt text
- [x] Source: `EnrichedSession.turns[].durationMs`

---

## Phase 4 — Session Control & Real-Time

### Control Panel Actions
- [x] "Start new session" button → `POST /api/sessions` with `{ cwd, prompt? }`, navigate to new session view on success
- [x] "Stop session" button → `POST /api/sessions/:id/stop`
- [x] "Resume session" button → `POST /api/sessions/:id/resume`
- [x] Add shadcn/ui `Sonner` toast for control action errors

### Message Input
- [x] Text input at bottom of `SessionView` → `POST /api/sessions/:id/message` with `{ content }`
- [x] `Enter` sends, `Shift+Enter` for newline
- [x] Clear input on successful send
- [x] No optimistic rendering — message appears via transcript → watcher → WS

### Session Status Indicator
- [x] Status badge in session header: green (running), gray (stopped), red (error), no dot (unknown)
- [x] Update reactively from WebSocket lifecycle events (`session:started`, `session:stopped`, `session:error`)

### WebSocket Reconnection
- [x] Implement exponential backoff: base 1000ms, max 30000ms, random jitter 0-500ms
- [x] On reconnect: re-fetch full `EnrichedSession`, clear `liveMessages`, re-subscribe
- [x] Connection status indicator in app header: hidden (connected), yellow "Connecting...", red "Reconnecting..." with attempt count

### Incremental Analytics
- [x] On incoming `WatchBatch`, update running token totals, cost, tool stats, context snapshots, and turn timeline incrementally
- [x] Deduplicate by `messageId` for token accounting
- [x] Full re-fetch on reconnect corrects any drift

### WebSocket Message Buffering
- [x] If WS messages arrive before REST fetch completes, buffer them and apply after baseline renders

---

## Phase 5 — Edge Cases, Error Handling & Polish

### Error Handling
- [x] REST fetch failure: retry up to 3 times with 1s delay, show error banner with retry button
- [x] 4xx errors: show error banner, no auto-retry; 5xx: auto-retry
- [x] Session not found (404): show "Session not found" with link back to project list
- [x] Malformed WS message: log to console, discard, do not crash
- [x] Add shadcn/ui `Alert` for error banners

### Keyboard Navigation
- [x] `/` (anywhere, input not focused) → focus message input
- [x] `j`/`k` in list views → move selection down/up
- [x] `Enter` in list views → navigate to selected item
- [x] `Escape` in message input → blur input
- [x] `Backspace` in session/session list view → navigate back

### Production Build
- [x] Configure `vite build` to output to `client/dist/`
- [x] Wire Hono server to serve `client/dist/` for non-API routes with SPA catch-all (verify existing static serving in `create-app.ts` works with client build output)
- [x] Verify hashed asset caching headers (immutable, max-age=31536000) and `index.html` no-cache

### Empty States
- [x] Project list: "No projects found" with transcript directory hint
- [x] Session list: "No sessions found"
- [x] Session with zero messages: `ConversationEmptyState` — "No messages yet"
