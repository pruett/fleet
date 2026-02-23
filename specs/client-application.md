# Client Application

The client application is a single-page React dashboard for browsing projects, viewing sessions, displaying analytics, and controlling Claude Code sessions. It fetches enriched data from the API Layer over REST, subscribes to live updates over WebSocket, and renders conversations with syntax highlighting. For the data structures it consumes, see [transcript-parser.md](transcript-parser.md). For the real-time protocol, see [file-watcher.md](file-watcher.md). For system context, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Where It Fits

```
+------------------+         +---------------------+
|    API Layer     |         | Real-time Transport |
|  (Hono on Bun)  |         |    (WebSocket)      |
+--------+---------+         +---------+-----------+
         |  REST                       |  WS
         |  - GET /projects            |  - subscribe(sessionId)
         |  - GET /sessions            |  - messages batch
         |  - GET /session/:id         |  - lifecycle events
         |  - POST /session/control    |
         v                             v
+------------------------------------------------------+
|                  Client Application                   |
|                   (React SPA)                         |
|                                                       |
|  Views:                                               |
|    ProjectListView  -> SessionListView -> SessionView |
|                                                       |
|  Panels (within SessionView):                         |
|    ConversationPanel  |  AnalyticsPanel               |
|    ToolCallPanel      |  ControlPanel                 |
+------------------------------------------------------+
```

## Technology

| Choice | Value | Rationale |
|--------|-------|-----------|
| Framework | React | Component model, ecosystem, team familiarity |
| Build | Vite | Fast HMR, native ESM, simple config |
| Language | TypeScript | Shared types with server |
| Styling | Tailwind CSS | Utility-first, no runtime cost, small bundle |
| Charting | Recharts (or similar lightweight lib) | Minimal dependency surface |
| Syntax highlighting | Lightweight library (e.g., Prism, Shiki) | Code blocks in assistant output |
| Component library | None | Custom components, keep it lean |

**Development:** Vite dev server on a separate port, proxying `/api/*` and `/ws` to the Hono server. **Production:** `vite build` outputs static files to `dist/`. The API server serves `dist/` for all non-API routes with a catch-all for client-side routing.

## Routing

Three top-level routes. No nested routing library required — a minimal client-side router or React Router is sufficient.

```
/                       -> ProjectListView
/project/:projectId     -> SessionListView
/session/:sessionId     -> SessionView
```

`projectId` is the raw directory name (e.g., `-Users-foo-code-bar`). `sessionId` is the UUID. Both are URL-safe without encoding.

Browser back/forward navigation works. Deep links work — opening `/session/abc-123` directly fetches and renders that session.

## Views

### ProjectListView

Fetches `GET /api/projects` on mount. Renders a list of `ProjectSummary` objects.

Each row shows:
- Decoded project path (e.g., `/Users/foo/code/bar`)
- Session count
- Last active timestamp (relative, e.g., "3 minutes ago")

Sorted by `lastActiveAt` descending (server-provided order). Clicking a row navigates to `/project/:projectId`.

**Empty state:** "No projects found" with a hint about the expected transcript directory.

### SessionListView

Fetches `GET /api/projects/:projectId/sessions` on mount. Renders a list of `SessionSummary` objects.

Each row shows:
- First prompt (truncated to ~100 characters)
- Model name
- Cost (formatted as USD)
- Token count (formatted with commas)
- Started / last active timestamps (relative)
- Git branch (if present)

Sorted by `lastActiveAt` descending (server-provided order). Clicking a row navigates to `/session/:sessionId`.

**Back navigation:** A breadcrumb or back link to the project list.

### SessionView

The primary view. Loads a full session and streams live updates. Layout is a two-column split: conversation on the left, analytics on the right. The analytics column is collapsible.

#### Load Sequence

```
1. Fetch GET /api/sessions/:sessionId -> EnrichedSession
2. Render conversation from EnrichedSession.messages
3. Render analytics from EnrichedSession enrichments
4. Open WebSocket connection
5. Send subscribe message: { type: "subscribe", sessionId }
6. On each incoming WatchBatch:
     append batch.messages to local message list
     re-render conversation tail
     update running analytics (see Incremental Analytics)
```

Steps 1-3 and 4-5 can run in parallel. The WebSocket subscription must happen after the REST fetch completes to avoid a race where live messages arrive before the baseline is rendered. If the WebSocket connects before the REST response, buffer incoming batches and apply them after the baseline renders.

#### Unload Sequence

```
1. Send unsubscribe message: { type: "unsubscribe", sessionId }
2. (WebSocket connection stays open for reuse if navigating to another session)
```

If the user navigates away from the app entirely, the WebSocket closes on page unload. No explicit cleanup needed — the server handles disconnect.

## Conversation Panel

Renders the flat `messages[]` array as a vertical thread. Each message kind maps to a visual component:

| Message Kind | Rendering |
|-------------|-----------|
| `user-human-prompt` | User bubble with prompt text. Skip if `isMeta: true`. |
| `assistant-block` (text) | Assistant bubble with markdown rendering and syntax highlighting for fenced code blocks. |
| `assistant-block` (thinking) | Collapsible "Thinking" block, collapsed by default. Monospace text. |
| `assistant-block` (tool_use) | Tool call header: tool name + collapsible input. Input rendered as syntax-highlighted JSON. |
| `user-tool-result` | Tool result block nested under its corresponding tool_use. Collapsible, collapsed by default for large outputs. Content rendered as plain text or syntax-highlighted code. |
| `system-api-error` | Error banner: red background, error message, retry info. |
| `system-turn-duration` | Turn duration badge at the end of the turn (e.g., "3.2s"). |
| `progress-bash` | Streaming bash output block with terminal-style monospace rendering. |
| `progress-agent` | Subagent indicator: "Agent started: {prompt}" |
| `file-history-snapshot` | Hidden. Not rendered in conversation. |
| `queue-operation` | Hidden. Not rendered in conversation. |
| `malformed` | Warning block with raw text, visible only in a debug/verbose mode. |

### Turn Grouping

Messages are visually grouped by turn. Each turn begins with a user prompt and spans all subsequent messages until the next user prompt. A subtle visual separator (line or spacing) divides turns. Turn index is displayed as a label.

### Auto-Scroll

The conversation panel auto-scrolls to the bottom when new messages arrive, **unless** the user has manually scrolled up. Scrolling up disengages auto-scroll. A "scroll to bottom" button appears when auto-scroll is disengaged. Clicking it or scrolling to the bottom re-engages auto-scroll.

```
on new messages:
  if userScrolledUp:
    show "scroll to bottom" indicator
    do not scroll
  else:
    scrollTo(bottom)

on user scroll:
  if scrollPosition is at bottom (within 50px threshold):
    userScrolledUp = false
    hide indicator
  else:
    userScrolledUp = true
```

### Collapsible Blocks

Thinking blocks, tool inputs, and tool results are collapsible. Default state:

| Block Type | Default State |
|-----------|---------------|
| Thinking | Collapsed |
| Tool input (JSON) | Collapsed |
| Tool result (short, < 10 lines) | Expanded |
| Tool result (long, >= 10 lines) | Collapsed, showing first 5 lines as preview |

A "expand all" / "collapse all" toggle at the top of the conversation panel controls all collapsible blocks at once.

## Analytics Panel

Displays computed analytics from the `EnrichedSession` enrichments. Five sub-panels:

### Token Usage

Bar chart or stacked bar showing per-response token breakdown:
- Input tokens
- Output tokens
- Cache read tokens
- Cache creation tokens

Source: `EnrichedSession.responses[].usage`

Summary row: total input, total output, total cache, total tokens (from `EnrichedSession.totals`).

### Cost

Cumulative cost line over time (one point per response). Running total displayed prominently.

Source: per-response cost derived from `responses[].usage` and the model pricing table. Total from `EnrichedSession.totals.estimatedCostUsd`.

### Context Window

Area chart showing context window utilization over the session's lifetime. X-axis: response index or turn index. Y-axis: token count.

Two series:
- Cumulative input tokens (how full the context is)
- Cumulative output tokens

Source: `EnrichedSession.contextSnapshots[]`

A horizontal reference line at the model's context window limit (if known) provides visual context for how close the session is to the limit.

### Tool Statistics

Table showing per-tool metrics:

| Tool | Calls | Errors | Error Rate |
|------|-------|--------|------------|
| Read | 12 | 0 | 0% |
| Bash | 8 | 2 | 25% |
| Edit | 5 | 1 | 20% |

Source: `EnrichedSession.toolStats[]`

Clicking a tool name could filter the conversation panel to show only that tool's calls (stretch goal — not required for initial implementation).

### Turn Timeline

Horizontal bar chart or timeline showing each turn's duration. Helps identify slow turns.

Source: `EnrichedSession.turns[].durationMs`

Each bar is labeled with the turn index and truncated prompt text.

### Incremental Analytics

When live messages arrive over WebSocket, the client updates analytics incrementally without re-fetching the full session:

```
on WatchBatch received:
  for each message in batch.messages:
    append to local messages array

    if message.kind == "assistant-block":
      update running token totals (deduplicate by messageId)
      update running cost
      append context snapshot if new messageId
      increment tool stats if contentBlock.type == "tool_use"

    if message.kind == "user-tool-result":
      update tool call pairing (match by toolUseId)
      update error counts if isError

    if message.kind == "system-turn-duration":
      update turn timeline with durationMs
```

This is a best-effort approximation. On reconnect (see WebSocket Reconnection), the client re-fetches the full `EnrichedSession` which corrects any drift.

## Session Control

The control panel provides actions for managing CLI sessions. All actions are REST calls to the API Layer; results flow back through the transcript file and WebSocket.

### Actions

| Action | API Call | Behavior |
|--------|----------|----------|
| Start new session | `POST /api/sessions/start` with `{ cwd, prompt? }` | Spawns a new CLI subprocess. Navigates to the new session view. |
| Stop session | `POST /api/sessions/:id/stop` | Sends interrupt signal to the CLI subprocess. |
| Resume session | `POST /api/sessions/:id/resume` | Resumes a stopped session. |
| Send message | `POST /api/sessions/:id/message` with `{ content }` | Queues a message to the running session. |

### Message Input

A text input at the bottom of the SessionView. Submitting sends the message via the API. The input clears on successful send. The message appears in the conversation when the CLI writes it to the transcript file and the watcher delivers it — the client does not optimistically render the sent message.

**Keyboard shortcut:** `Enter` sends (with `Shift+Enter` for newline). The input supports multi-line text.

### Session Status Indicator

A status badge in the session header showing the current session state. The state is derived from WebSocket lifecycle events broadcast by the Real-time Transport:

| State | Badge | Meaning |
|-------|-------|---------|
| Running | Green dot | CLI subprocess is active |
| Stopped | Gray dot | Session ended or was interrupted |
| Error | Red dot | CLI subprocess crashed |
| Unknown | No dot | No lifecycle info available (e.g., old session) |

The server broadcasts lifecycle events (`session:started`, `session:stopped`, `session:error`) to all connected clients. The client updates the badge reactively.

## WebSocket Connection

### Connection Lifecycle

The client maintains a single WebSocket connection to the server, reused across session navigations.

```
on app mount:
  connect()

on session open:
  send { type: "subscribe", sessionId }

on session close (navigate away):
  send { type: "unsubscribe", sessionId }

on app unmount:
  ws.close()
```

### Message Protocol

Messages are JSON-encoded. The client handles these server-to-client message types:

```
// Batch of new parsed messages for a subscribed session
{ type: "messages", sessionId: string, messages: ParsedMessage[] }

// Session lifecycle event (broadcast to all clients)
{ type: "lifecycle", sessionId: string, event: "started" | "stopped" | "error", detail?: string }
```

Client-to-server messages:

```
{ type: "subscribe", sessionId: string }
{ type: "unsubscribe", sessionId: string }
```

### Reconnection

On connection drop, the client reconnects with exponential backoff. After reconnecting, it re-fetches the full session (if one is open) and re-subscribes.

```
baseDelay   = 1000 ms
maxDelay    = 30000 ms
attempt     = 0

on disconnect:
  delay = min(baseDelay * 2^attempt, maxDelay) + random jitter (0-500ms)
  attempt += 1
  setTimeout(connect, delay)

on successful connect:
  attempt = 0
  if currentSessionId:
    fetch GET /api/sessions/:currentSessionId -> EnrichedSession
    replace local state with fresh EnrichedSession
    send { type: "subscribe", sessionId: currentSessionId }
```

The full re-fetch on reconnect guarantees consistency. Messages written during the disconnection are captured by the fresh parse. No gap-detection or message-replay protocol is needed.

### Connection Status Indicator

A small indicator in the app header shows WebSocket connection state:

| State | Display |
|-------|---------|
| Connected | Hidden (no indicator — this is the normal state) |
| Connecting | Yellow dot, "Connecting..." |
| Disconnected | Red dot, "Reconnecting..." with attempt count |

## Keyboard Navigation

| Key | Context | Action |
|-----|---------|--------|
| `Enter` | Message input focused | Send message (`Shift+Enter` for newline) |
| `Escape` | Message input focused | Blur input |
| `/` | Anywhere (input not focused) | Focus message input |
| `j` / `k` | List views | Move selection down / up |
| `Enter` | List views with selection | Navigate to selected item |
| `Backspace` | Session or session list view | Navigate back |

Keyboard navigation is additive — all views remain fully mouse-operable.

## State Management

Client state is minimal and ephemeral. No persistent client-side storage.

### State Shape

```
{
  // Navigation
  route:             { view: "projects" }
                   | { view: "sessions", projectId: string }
                   | { view: "session", sessionId: string }

  // Data (populated by REST fetches)
  projects:          ProjectSummary[] | null        // null = not yet loaded
  sessions:          SessionSummary[] | null
  enrichedSession:   EnrichedSession | null

  // Live state (mutated by WebSocket)
  liveMessages:      ParsedMessage[]                // appended incrementally
  runningTotals:     TokenTotals                     // updated incrementally
  sessionStatus:     "running" | "stopped" | "error" | "unknown"

  // UI state
  wsConnected:       boolean
  autoScroll:        boolean
}
```

### Data Flow

```
REST fetch     -> replace projects / sessions / enrichedSession
WebSocket msg  -> append to liveMessages, update runningTotals
Navigation     -> clear stale data, trigger new fetch
Reconnect      -> re-fetch enrichedSession, replacing liveMessages
```

The `enrichedSession` from REST and `liveMessages` from WebSocket are combined for rendering:

```
displayMessages = enrichedSession.messages + liveMessages
```

On reconnect, `liveMessages` is cleared and `enrichedSession` is replaced with the fresh fetch, which now includes all previously-live messages.

## Error Handling

| Scenario | Detection | User-Facing Behavior |
|----------|-----------|---------------------|
| REST fetch fails (network) | `fetch` rejects | Retry up to 3 times with 1s delay. Show error banner: "Failed to load. Retrying..." then "Failed to load. [Retry]" |
| REST fetch fails (4xx/5xx) | Non-2xx status | Show error banner with status and message. No auto-retry for 4xx. Retry for 5xx. |
| WebSocket disconnects | `onclose` event | Auto-reconnect with backoff (see Reconnection). Show connection status indicator. |
| Malformed WebSocket message | JSON parse fails | Log to console. Discard message. Do not crash. |
| Session not found | 404 from session fetch | Show "Session not found" with link back to project list. |
| Control action fails | Non-2xx from control endpoint | Show toast notification with error message. Do not navigate away. |
| Empty enriched session | `EnrichedSession` with 0 messages | Show "This session has no messages yet." If session is running, live messages will appear. |

## Concrete Example

A user opens Fleet and navigates to a live session.

**Step 1: App loads**

```
Browser opens /
  -> ProjectListView mounts
  -> fetch GET /api/projects
  -> response: [
       { id: "-Users-foo-code-bar", path: "/Users/foo/code/bar", sessionCount: 3, lastActiveAt: "..." },
       { id: "-Users-foo-code-baz", path: "/Users/foo/code/baz", sessionCount: 1, lastActiveAt: "..." },
     ]
  -> render 2 project rows
  -> open WebSocket connection to ws://localhost:PORT/ws
```

**Step 2: User clicks a project**

```
Click "-Users-foo-code-bar"
  -> navigate to /project/-Users-foo-code-bar
  -> SessionListView mounts
  -> fetch GET /api/projects/-Users-foo-code-bar/sessions
  -> response: [
       { sessionId: "abc-123", firstPrompt: "Fix the login bug", model: "claude-opus-4-6", cost: 0.42, ... },
       { sessionId: "def-456", firstPrompt: "Add unit tests", model: "claude-sonnet-4", cost: 0.08, ... },
     ]
  -> render 2 session rows
```

**Step 3: User clicks a live session**

```
Click "abc-123"
  -> navigate to /session/abc-123
  -> SessionView mounts
  -> fetch GET /api/sessions/abc-123 -> EnrichedSession with 20 messages, 4 turns
  -> render conversation: 4 turns with user prompts, assistant text, tool calls
  -> render analytics: token chart, cost $0.42, 3 tools used
  -> send WS: { type: "subscribe", sessionId: "abc-123" }
```

**Step 4: CLI writes new messages**

```
WS receives: {
  type: "messages",
  sessionId: "abc-123",
  messages: [
    { kind: "assistant-block", contentBlock: { type: "text", text: "I found the issue..." }, ... }
  ]
}
  -> append to liveMessages
  -> new assistant bubble appears at bottom of conversation
  -> auto-scroll fires (user has not scrolled up)
  -> running token totals update
  -> cost display updates
```

**Step 5: User sends a message**

```
User types "Can you also fix the logout bug?" and presses Enter
  -> POST /api/sessions/abc-123/message { content: "Can you also fix the logout bug?" }
  -> input clears
  -> (CLI receives the message, writes to transcript, watcher picks it up)
  -> WS receives the user-human-prompt message
  -> new user bubble appears in conversation
  -> (CLI processes and writes assistant response)
  -> WS receives assistant-block messages
  -> new assistant bubbles appear
```

**Step 6: WebSocket drops and recovers**

```
t=0s:    WS connection drops (network blip)
         -> connection indicator: "Reconnecting..."
         -> attempt = 0, delay = 1000ms + jitter

t=1.2s:  reconnect attempt 1 succeeds
         -> attempt = 0
         -> fetch GET /api/sessions/abc-123 -> fresh EnrichedSession (now 28 messages)
         -> replace enrichedSession, clear liveMessages
         -> conversation re-renders with all 28 messages (no gap)
         -> analytics re-render from fresh enrichments
         -> send WS: { type: "subscribe", sessionId: "abc-123" }
         -> connection indicator hides
```

## Verification

1. **Full session render.** Open a session with N messages. The conversation panel renders exactly N visible message components (excluding hidden kinds like `file-history-snapshot`). Turn grouping matches `EnrichedSession.turns`.

2. **Live message delivery.** With a session open, append a new line to the transcript file. The corresponding message appears in the conversation panel within 1 second. No page refresh required.

3. **Analytics accuracy.** The token totals, cost, and tool statistics displayed in the analytics panel match the values in the `EnrichedSession` returned by the API. No rounding discrepancies beyond display formatting.

4. **Auto-scroll behavior.** With auto-scroll engaged, new messages scroll into view automatically. After the user scrolls up, new messages do not cause scrolling. The "scroll to bottom" indicator appears. Clicking it scrolls to bottom and re-engages auto-scroll.

5. **Session control round-trip.** Send a message via the control panel. The message appears in the conversation (delivered via the transcript and watcher, not optimistic). Stop a session — the status badge changes to "Stopped."

6. **WebSocket reconnection.** Disconnect the WebSocket (e.g., kill the server briefly). The client shows "Reconnecting..." indicator, reconnects after backoff, re-fetches the session, and resumes live updates. No messages are lost — the re-fetched session includes all messages written during the disconnection.

7. **Deep link.** Open `/session/abc-123` directly in a new browser tab. The session loads and renders correctly without first visiting the project list.

8. **Empty states.** A project with zero sessions shows the empty state message. A session with zero messages shows "no messages yet."

9. **Collapsible blocks.** Thinking blocks render collapsed. Clicking expands them. "Expand all" expands every collapsible block. "Collapse all" collapses them.

10. **Syntax highlighting.** A text block containing a fenced code block (e.g., ` ```typescript ... ``` `) renders with syntax highlighting. A tool_use input renders as highlighted JSON.

11. **Keyboard navigation.** Pressing `/` focuses the message input. `j`/`k` moves through list items. `Enter` selects. `Backspace` navigates back.

12. **Error resilience.** A failed REST fetch shows an error banner with retry option. A malformed WebSocket message is discarded without crashing the app. A 404 session shows "not found."

13. **No duplicate messages on reconnect.** Disconnect, let 5 messages arrive on the server side, reconnect. After reconnect, the conversation shows exactly the right number of messages — no duplicates from the overlap between the old session and the re-fetched one.

14. **Incremental analytics consistency.** Open a live session with 10 turns. Let 3 more turns arrive over WebSocket. The running totals in the analytics panel approximate the values that a full re-fetch would produce. After a forced refresh (reconnect), the analytics match exactly.

15. **Back navigation.** From a session view, pressing the browser back button returns to the session list. From the session list, back returns to the project list. No broken states.
