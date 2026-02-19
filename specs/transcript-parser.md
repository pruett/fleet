# Transcript Parser

The transcript parser transforms append-only JSONL session files into structured, analytics-ready data. For the raw JSONL format, see [jsonl-transcript-spec.md](jsonl-transcript-spec.md). For the parser's role within Fleet, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Where It Fits

```
+---------------------------+       +---------------------------+
|        API Layer          |       |       File Watcher        |
| parseFullSession(file) ──>|       |<── parseLine(json, index) |
| receives EnrichedSession  |       | receives ParsedMessage    |
+-------------+-------------+       +-------------+-------------+
              |                                    |
              v                                    v
+-------------------------------------------------------------+
|                    Transcript Parser                         |
|                                                             |
|  parseLine       — classify one JSONL line                  |
|  enrichSession   — build cross-message structures           |
|  parseFullSession — compose both                            |
+-------------------------------------------------------------+
```

## The Three Functions

```
parseLine(rawJson: string, lineIndex: integer) -> ParsedMessage | null
```

Pure function. Parses one JSONL line, validates its shape, and returns a typed `ParsedMessage`. Returns `null` for blank lines. Returns a `MalformedRecord` if validation fails.

```
enrichSession(messages: ParsedMessage[]) -> EnrichedSession
```

Takes the full array of parsed messages and builds cross-message structures: turns, reconstituted responses, tool call pairings, token totals, tool stats, subagent refs, and context snapshots.

```
parseFullSession(fileContents: string) -> EnrichedSession

  lines    = fileContents.split("\n").filter(nonEmpty)
  messages = lines.map((line, i) => parseLine(line, i)).filter(nonNull)
  return enrichSession(messages)
```

Composes the other two. This is what the API Layer calls.

## Line Classification

`parseLine` matches on `type` (and subtypes) to produce a specific message kind:

```
match json.type:
  "file-history-snapshot" -> FileHistorySnapshotMessage
  "user"                  -> if content is string: UserHumanPromptMessage
                             if content is array:  UserToolResultMessage
  "assistant"             -> AssistantBlockMessage
  "system"                -> match subtype:
                               "turn_duration"  -> SystemTurnDurationMessage
                               "api_error"      -> SystemApiErrorMessage
                               "local_command"  -> SystemLocalCommandMessage
  "progress"              -> match data.type:
                               "agent_progress" -> ProgressAgentMessage
                               "bash_progress"  -> ProgressBashMessage
                               "hook_progress"  -> ProgressHookMessage
  "queue-operation"       -> QueueOperationMessage
```

## Message Types

| Kind | Key Fields | What it represents |
|------|-----------|-------------------|
| `file-history-snapshot` | `snapshot`, `isSnapshotUpdate` | File backup state at a point in time |
| `user-human-prompt` | `content` (string), `isMeta`, `cwd`, `gitBranch` | Human-typed prompt (or system-injected if `isMeta`) |
| `user-tool-result` | `results[]`, `toolUseResult` | Tool execution results returned to the model |
| `assistant-block` | `messageId`, `model`, `contentBlock`, `usage` | One block of an API response (text, thinking, or tool_use) |
| `system-turn-duration` | `durationMs` | How long a turn took |
| `system-api-error` | `error`, `retryInMs`, `retryAttempt` | API error with retry info |
| `system-local-command` | `content` | Local CLI command record |
| `progress-agent` | `agentId`, `prompt`, `parentToolUseID` | Subagent task in progress |
| `progress-bash` | `output`, `elapsedTimeSeconds` | Bash command streaming output |
| `progress-hook` | `hookEvent`, `hookName` | Hook execution in progress |
| `queue-operation` | `operation`, `content` | Message queue enqueue/remove/dequeue |
| `malformed` | `rawText`, `error` | Line that failed validation |

All message types except `queue-operation`, `file-history-snapshot`, and `malformed` carry common fields: `uuid`, `parentUuid`, `sessionId`, `timestamp`, and `lineIndex`.

## Enrichments

`enrichSession` runs these steps to build the `EnrichedSession`:

### Turn Construction

A turn starts at every non-meta human prompt and spans all records up to the next one.

```
for each message:
  if kind = "user-human-prompt" AND isMeta = false:
    start a new turn
  else:
    add to current turn
```

Records before the first real prompt (snapshots, meta messages) belong to no turn but remain in the flat `messages[]` array.

### Response Reconstitution

One Claude API response can contain multiple content blocks (thinking, text, tool_use). Each block is written as a separate JSONL line, but they all share the same `messageId`. Reconstitution groups them back into a single response.

```
-- Three JSONL lines, one API response:
line 2: assistant, messageId: "A", contentBlock: thinking("Let me look...")
line 3: assistant, messageId: "A", contentBlock: text("I found the issue")
line 4: assistant, messageId: "A", contentBlock: tool_use(Bash, "git diff")

-- Reconstituted into:
ReconstitutedResponse {
  messageId: "A",
  blocks: [thinking, text, tool_use],   -- ordered by line index
  usage: <from line 4>,                 -- last block has final token counts
}
```

### Tool Call Pairing

Tool-use blocks and tool-result blocks are matched by `toolUseId`. Unmatched tool-use blocks (still executing or session crashed) get `toolResultBlock: null`.

### Token Aggregation

Assistant blocks sharing a `messageId` carry duplicated input/cache tokens but cumulative output tokens. The parser deduplicates by `messageId` (keeping the last block per response) and sums across all responses. Cost is computed per-response using a model pricing table.

### Tool Statistics

Counts total calls, successes, and errors per tool name. Errors include the error text and turn index.

### Subagent References

Correlates `Task` tool-use blocks, `agent_progress` records, and tool results to build `SubagentRef` entries with `agentId`, `prompt`, aggregate stats, and the subagent transcript path. Does **not** recursively parse subagent files.

### Context Snapshots

After each non-synthetic API response, records a snapshot of token usage (input, output, cache tokens, cumulative output). The client uses these to visualize context window utilization over time.

## Concrete Example

A finished session on disk:

```
session-abc.jsonl
─────────────────
line 0:  { type: "file-history-snapshot", ... }
line 1:  { type: "user",      content: "Read my README" }
line 2:  { type: "assistant",  content: [tool_use: Read], msg_id: "A" }
line 3:  { type: "user",      content: [tool_result: "# My Project..."] }
line 4:  { type: "assistant",  content: [text: "Your README says..."], msg_id: "B" }
line 5:  { type: "system",    subtype: "turn_duration", durationMs: 3200 }
```

User opens this session. The API calls `parseFullSession` on the whole file:

```
result = {
  messages: [ ...all 6... ],
  turns: [{
    prompt: "Read my README",
    responses: [A, B],
    toolCalls: [Read -> ok],
    durationMs: 3200,
  }],
  totals: { inputTokens: 150, outputTokens: 80, turnCount: 1, toolUseCount: 1 },
  toolStats: { "Read": { calls: 1, errors: 0 } },
}
```

## Two Modes

**Full parse** — The API Layer calls `parseFullSession` when a client opens a session. Reads the entire file, classifies every line, runs all enrichments.

**Incremental parse** — The File Watcher calls `parseLine` on each new line appended to a live session. No enrichment. The raw `ParsedMessage` is sent to the client over the websocket.

Enrichments are full-parse-only because:

1. **Simplicity.** The parser stays a pure function with no mutable server-side state.
2. **Correctness.** Some enrichments are retrospective (a turn's end is only known when the next turn starts).
3. **Performance.** A full parse of a 500-line file is cheap. A fresh parse on reconnect is simpler than replaying incremental enrichments.
