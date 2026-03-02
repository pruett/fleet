# Conversation Rendering Reference

How session messages flow from the JSONL transcript through filtering, grouping, and rendering in the client UI.

---

## Message Types

There are **12 message kinds** defined in `client/src/types/api.ts`. Each line in a session's JSONL transcript is one of these types.

### Rendered in Conversation View

| Kind | Description | Key Fields | Renderer |
|------|-------------|------------|----------|
| `user-prompt` | User-submitted text message. Starts a new turn. | `uuid`, `parentUuid`, `text`, `isMeta`, `timestamp` | `<Message from="user">` with `<MessageResponse>` (Streamdown markdown) |
| `assistant-block` (text) | A single text content block from an assistant response. Multiple blocks share the same `messageId`. | `messageId`, `model`, `contentBlock: { type: "text", text }`, `usage` | `<Message from="assistant">` with `<MessageResponse>` (Streamdown markdown) |
| `assistant-block` (thinking) | Extended-thinking / reasoning content block. | `messageId`, `contentBlock: { type: "thinking", thinking, signature }` | `<Reasoning>` — collapsible panel showing "Thought for N seconds", default closed |
| `system-api-error` | API call failure with retry info. | `error`, `retryInMs`, `retryAttempt`, `maxRetries` | `<ApiErrorBlock>` — red error banner with retry countdown |
| `progress-agent` | Subagent spawned (Task tool invocation). | `agentId`, `prompt`, `parentToolUseID` | `<AgentProgressBlock>` — gray info text: "Agent started: {prompt}" |

### Hidden (Filtered Out Before Rendering)

| Kind | Description | Key Fields | Why Hidden |
|------|-------------|------------|------------|
| `assistant-block` (tool_use) | Tool invocation block (Bash, Read, Write, etc.). | `contentBlock: { type: "tool_use", id, name, input }` | Returned as `null` by `MessageAdapter`; data feeds analytics only |
| `user-tool-result` | Result of a tool execution, paired to a tool_use block by `toolUseId`. | `results[]` (each with `toolUseId`, `content`, `isError`), `toolUseResult` | Not rendered; results are consumed by analytics for error tracking |
| `file-history-snapshot` | Tracks file state for undo/restore. | `messageId`, `snapshot`, `isSnapshotUpdate` | Internal state management |
| `queue-operation` | Queue system events (enqueue, dequeue). | `operation`, `content` | Internal metadata |
| `system-local-command` | Local shell command execution log. | `content` | Internal execution trace |
| `progress-hook` | Pre/post-hook lifecycle events. | `hookEvent`, `hookName`, `command` | Internal hook execution trace |
| `progress-bash` | Bash command output streaming. | `output`, `elapsedTimeSeconds` | Redundant with tool_use/tool_result data |
| `system-turn-duration` | Turn completion timing. | `parentUuid`, `durationMs` | Analytics-only; consumed for turn duration tracking |
| `malformed` | Lines that failed JSON parsing. | `raw`, `error` | Parse failures; nothing meaningful to display |

---

## Content Block Types

Content blocks are the atomic units inside `assistant-block` messages. Defined in `types/api.ts`:

| Type | Fields | Rendered | Notes |
|------|--------|----------|-------|
| `text` | `{ type: "text", text: string }` | Yes — Streamdown markdown with code highlighting, math, mermaid, CJK plugins | Main assistant output |
| `thinking` | `{ type: "thinking", thinking: string, signature: string }` | Yes — collapsible `<Reasoning>` panel | Duration computed from timestamps between consecutive thinking blocks |
| `tool_use` | `{ type: "tool_use", id: string, name: string, input: Record<string, unknown> }` | No | Used for analytics (tool call counts, error attribution via `id` ↔ `toolUseId` pairing) |

---

## Visibility Filtering

Filtering happens in `message-adapter.tsx` via `isVisibleMessage()`, called from `useSessionData` before messages reach the UI.

### Filter Rules

1. **Kind-based exclusion** — these kinds are always hidden:
   - `file-history-snapshot`, `queue-operation`, `system-local-command`, `progress-hook`, `progress-bash`

2. **Malformed exclusion** — `malformed` records are always hidden.

3. **Meta prompt exclusion** — `user-prompt` with `isMeta === true` (system-injected prompts) are hidden.

4. **XML-tag exclusion** — `user-prompt` messages matching `isXmlTagMessage()` are hidden:
   ```
   /^<[a-z-]+[\s>]/i  ...  /<\/[a-z-]+>\s*$/i
   ```
   This filters slash-command outputs like `<pdf-summary>...</pdf-summary>`.

### Filtering Pipeline

```
session.messages + liveMessages (WebSocket)
    → deduplicate by lineIndex
    → filter via isVisibleMessage()
    → visibleMessages (passed to SessionPanel)
```

---

## Turn Grouping

Defined in `conversation/TurnGroup.tsx` via `groupMessagesByTurn()`.

### Algorithm

1. Messages before the first `user-prompt` → pre-turn group (`turnIndex: null`)
2. Each `user-prompt` increments `turnIndex` (1-based) and starts a new group
3. All subsequent messages belong to that turn until the next `user-prompt`

### TurnGroupData Structure

```typescript
{
  turnIndex: number | null;  // null = pre-turn, 1+ = user turn
  messages: ParsedMessage[];
}
```

### Rendering Flow

```
visibleMessages
    → groupMessagesByTurn()
    → <TurnGroup> per group
        → <MessageAdapter> per message
            → dispatches to correct renderer (or null)
```

---

## Rendering Components

### Dispatch (`message-adapter.tsx` → `MessageAdapter`)

| Condition | Output |
|-----------|--------|
| `user-prompt` | `<Message from="user"><MessageResponse text={...}>` |
| `assistant-block` + `type: "text"` | `<Message from="assistant"><MessageResponse text={...}>` |
| `assistant-block` + `type: "thinking"` | `<Reasoning>` collapsible with `<ReasoningContent>` |
| `assistant-block` + `type: "tool_use"` | `null` (not rendered) |
| `system-api-error` | `<ApiErrorBlock>` |
| `progress-agent` | `<AgentProgressBlock>` |
| Anything else | `null` |

### Component Hierarchy

```
<SessionPanel>
  <Sheet>                              // Analytics side-sheet wrapper
    <Conversation>                     // Auto-scroll (StickToBottom)
      <ConversationContent>            // Flex column layout
        <TurnGroup>                    // Per-turn container
          <MessageAdapter>             // Dispatcher
            <Message>                  // Role-styled wrapper (user/assistant)
              <MessageContent>
                <MessageResponse>      // Streamdown markdown renderer
            <Reasoning>                // Collapsible thinking panel
            <ApiErrorBlock>            // Error banner
            <AgentProgressBlock>       // Agent info text
      <ConversationScrollButton>       // Scroll-to-bottom FAB
    <PromptInput>                      // Message input area
  <SheetContent>
    <AnalyticsPanel>                   // Token/tool/turn analytics
```

---

## Data Flow

### Initial Load

1. `fetchSession(sessionId)` → REST → `EnrichedSession`
2. `extractAnalytics(session)` → pre-compute totals, turns, responses, tool stats
3. Track baseline `lineIndex` set (for deduplicating live messages)
4. Open WebSocket → subscribe to session

### Live Updates

1. WebSocket receives `MessageBatch`
2. Filter to novel messages (not in baseline, not already in live set)
3. Append to `liveMessages` state
4. `applyBatch()` incrementally updates analytics:
   - Deduplicate by `messageId` for token counting
   - Accumulate tool stats (call counts, errors)
   - Track turn durations
   - Build response entries

### Reconnection

- Full session refetch on reconnect
- Reset baseline to fresh data
- Continue processing live messages

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/types/api.ts` | All message, content block, and session type definitions |
| `client/src/views/SessionPanel.tsx` | Main session viewer — layout, header, message list, input |
| `client/src/hooks/use-session-data.ts` | Session loading, WebSocket subscription, visibility filtering |
| `client/src/components/conversation/message-adapter.tsx` | `isVisibleMessage()` filter + `MessageAdapter` dispatch |
| `client/src/components/conversation/TurnGroup.tsx` | `groupMessagesByTurn()` + turn container component |
| `client/src/components/conversation/custom-blocks.tsx` | `ApiErrorBlock` and `AgentProgressBlock` renderers |
| `client/src/components/ai-elements/message.tsx` | `<Message>`, `<MessageContent>`, `<MessageResponse>` primitives |
| `client/src/components/ai-elements/reasoning.tsx` | `<Reasoning>` collapsible thinking block |
| `client/src/components/ai-elements/conversation.tsx` | `<Conversation>`, scroll management, empty state |
| `client/src/components/ai-elements/prompt-input.tsx` | Message input with file attachment support |
| `client/src/lib/incremental-analytics.ts` | Incremental token/tool/turn tracking from live batches |
