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

Auto-refresh: WebSocket Connection A (lifecycle + file-change events)
              + 30s polling fallback


┌──────────────────────────────────────────┐
│ Model: claude-opus | ID: abc | Branch: main  ◄── EnrichedSession metadata
│ [Connecting… / Reconnecting…]            ◄── WebSocket connectionInfo
├──────────────────────────────────────────┤
│                                          │
│ [User message]       ◄── ParsedMessage (kind: "user-prompt", !isMeta)
│ [Assistant response]  ◄── ParsedMessage (kind: "assistant-block", type: "text")
│ [Thinking block]      ◄── ParsedMessage (kind: "assistant-block", type: "thinking")
│ [API Error banner]    ◄── ParsedMessage (kind: "system-api-error")
│ [Agent progress]      ◄── ParsedMessage (kind: "progress-agent")
│                                          │
│ Data source: GET /api/sessions/:id (baseline)
│            + WebSocket Connection B messages (live appends)
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

## Websocket Connections
- Both connect to /ws with auto-reconnect (exponential backoff: 1s base, 30s max, 0-500ms jitter).

1. Connection A: Global Activity Monitor (useSessionActivity)
Mounted once at DashboardView root. Never subscribes to a specific session — it passively receives broadcast events.

Listens for (Server → Client):

session:started → invalidates ["sessions"] query cache (500ms debounce)
session:stopped → invalidates ["sessions"] query cache (500ms debounce)
session:file-changed → invalidates ["sessions"] query cache (500ms debounce)
Also: Polls every 30s to force-invalidate ["sessions"] cache (keeps timeAgo() timestamps fresh).

Effect: Sidebar session lists auto-refresh when sessions start/stop/change.

2. Connection B: Session Subscription (useSessionData)
Created per-session when SessionPanel mounts. Destroyed on unmount.

Client → Server:

{ type: "subscribe", sessionId } — on initial connect + on reconnect
{ type: "unsubscribe" } — on cleanup
Server → Client:
