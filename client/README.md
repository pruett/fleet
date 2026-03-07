# Fleet client

## UI Interactions
┌──────────────────────┐
│ Fleet                │
│ Projects             │
│ ├─ Project A  ◄──────── GET /api/projects → GroupedProject[]
│ │  ├─ session-1 ◄────── GET /api/projects/:slug/sessions → SessionSummary[]
│ │  └─ session-2        (lazy-loaded on expand, paginated at 15)
│ └─ Project B         │
│    └─ ...            │
│ [+ Add project] ◄────── GET /api/directories (on demand)
│                      │   PUT /api/config (on add/remove)
│ [⌘K Search] ◄────────── Reads React Query cache (all session queries)
└──────────────────────┘

Auto-refresh: 30s polling


┌──────────────────────────────────────────┐
│ Model: claude-opus | ID: abc | Branch: main  ◄── EnrichedSession metadata
│ [Connecting… / Reconnecting…]            ◄── SSE connectionInfo
├──────────────────────────────────────────┤
│                                          │
│ [User message]       ◄── ParsedMessage (kind: "user-prompt", !isMeta)
│ [Assistant response]  ◄── ParsedMessage (kind: "assistant-block", type: "text")
│ [Thinking block]      ◄── ParsedMessage (kind: "assistant-block", type: "thinking")
│ [API Error banner]    ◄── ParsedMessage (kind: "system-api-error")
│ [Agent progress]      ◄── ParsedMessage (kind: "progress-agent")
│                                          │
│ Data source: GET /api/sessions/:id (baseline)
│            + SSE stream messages (live appends)
├──────────────────────────────────────────┤
│ [Prompt textarea]                        │
│ [📎 Attach] [🌐 Web] [Context ◄── liveAnalytics + contextSnapshots]  [Send]
│                                          │
│ Send: POST /api/sessions/:id/message     │
│ Stop: POST /api/sessions/:id/stop        │
│ Resume: POST /api/sessions/:id/resume    │
│ New: POST /api/sessions                  │
└──────────────────────────────────────────┘

### Message Visibility
| Kind | Rendered As | Condition |
| --- | --- | --- |
| user-prompt | User message bubble | !isMeta AND not XML-tag-only |
| assistant-block (text) | Markdown (via Streamdown) | Always |
| assistant-block (thinking) | Collapsible reasoning block | Always |
| assistant-block (tool_use) | Hidden | — |
| system-api-error | Red error banner | Always |
| progress-agent | Subagent indicator | Always |
| All others | Hidden | — |

## SSE Connection

Per-session SSE stream via `GET /api/sse/sessions/:sessionId` (useSessionData → useSSE).

- Uses the native `EventSource` API with built-in reconnection.
- Subscription is implicit in the URL — connecting to a session URL subscribes to that session.
- Disconnection triggers automatic cleanup on the server.
- No client→server messages needed (all mutations go through REST).

Created per-session when SessionPanel mounts. Destroyed on unmount.

Server → Client (named SSE events):

- `messages` — batch of new ParsedMessage objects with byteRange
- `session:started` — session process started
- `session:stopped` — session process stopped
- `session:error` — session process error
- `session:activity` — session file activity

Server also sends `: keepalive` comments every 30s to prevent connection timeout.
