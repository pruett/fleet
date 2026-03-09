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

## Message Types Reference

All `ParsedMessage` types consumed by the client, including hidden internal types.

| Kind | Content Fields | Visible? | Notes |
|---|---|---|---|
| `user-prompt` | `text`, `isMeta`, `gitBranch`, `sessionId`, `timestamp` | **Visible** | Hidden if `isMeta: true` or text is XML-tag-only (slash commands) |
| `assistant-block` (TextBlock) | `messageId`, `model`, `text`, `usage`, `isSynthetic` | **Visible** | Rendered as `MessageResponse` bubble |
| `assistant-block` (ThinkingBlock) | `messageId`, `model`, `thinking`, `signature`, `usage`, `isSynthetic` | **Visible** | Rendered as `Reasoning` component |
| `assistant-block` (ToolUseBlock) | `messageId`, `model`, `id`, `name`, `input`, `usage`, `isSynthetic` | **Hidden** | Returns `null` in render — not displayed |
| `system-api-error` | `error`, `retryInMs`, `retryAttempt`, `maxRetries` | **Visible** | Red error banner with retry info |
| `progress-agent` | `agentId`, `prompt`, `parentToolUseID` | **Visible** | Subagent progress indicator |
| `progress-bash` | `output`, `elapsedTimeSeconds` | **Hidden** | In `HIDDEN_KINDS` set |
| `user-tool-result` | `results`, `toolUseResult` | **Hidden** | Returns `null` in render switch |
| `system-turn-duration` | `parentUuid`, `durationMs` | **Hidden** | Returns `null` in adapter |
| `file-history-snapshot` | `messageId`, `snapshot`, `isSnapshotUpdate` | **Hidden** | In `HIDDEN_KINDS` set |
| `queue-operation` | `operation`, `content` | **Hidden** | In `HIDDEN_KINDS` set |
| `system-local-command` | `content` | **Hidden** | In `HIDDEN_KINDS` set |
| `progress-hook` | `hookEvent`, `hookName`, `command` | **Hidden** | In `HIDDEN_KINDS` set |
| `malformed` | `raw`, `error` | **Hidden** | Explicit check in `isVisibleMessage()` |

14 rows — 4 visible, 10 hidden. Visibility controlled by `HIDDEN_KINDS` set in `message-adapter.tsx` plus additional logic in `isVisibleMessage()`. Messages are grouped into turns starting at each `user-prompt`.
