# Claude Code JSONL Transcript Format Specification

This document specifies the format of the append-only JSONL transcript files that Claude Code writes during sessions. It is a reference for any system that reads these files.

## Directory Layout

```
~/.claude/projects/
├── -Users-kevinpruett-code-fleet/              # Project directory
│   ├── 0a6afc57-2f31-4cb4-8ff0-01247f50c64c.jsonl   # Session transcript
│   ├── 0a6afc57-2f31-4cb4-8ff0-01247f50c64c/        # Companion directory (when subagents exist)
│   │   └── subagents/
│   │       └── agent-a748733.jsonl                    # Subagent transcript
│   ├── 8a6dc86d-84bb-4278-98ef-9065d9332d1b.jsonl   # Another session
│   └── memory/                                        # Project-level memory (not per-session)
├── -Users-kevinpruett-code-other-project/
│   └── ...
```

**Project directories** are named by replacing `/` with `-` in the absolute path of the working directory (e.g., `/Users/kevinpruett/code/fleet` becomes `-Users-kevinpruett-code-fleet`). This encoding is lossy — hyphens in the original path are indistinguishable from path separators.

**Session files** are named `{sessionId}.jsonl` where the `sessionId` is a UUID v4. Every record inside the file carries the same `sessionId` value, so the filename and contents are always in agreement.

**Subagent files** live in a companion directory named after the parent session: `{parentSessionId}/subagents/agent-{agentId}.jsonl`. The `agentId` is a 7-character hex string (a short hash derived from the agent's message UUID).

## Record Types

Every line in a JSONL file is a self-contained JSON object with a `type` field. Six distinct types exist:

### `file-history-snapshot` — File Edit Tracking

**Always the first line of every session file.** Tracks which files the session has edited for undo/restore purposes.

```jsonc
{
  "type": "file-history-snapshot",
  "messageId": "ad3f498d-...",
  "snapshot": {
    "messageId": "ad3f498d-...",
    "trackedFileBackups": {},           // empty on init
    "timestamp": "2026-02-11T16:05:29.887Z"
  },
  "isSnapshotUpdate": false             // true for subsequent snapshots mid-session
}
```

Additional snapshots with `isSnapshotUpdate: true` appear throughout the file whenever files are edited, with `trackedFileBackups` populated.

### `user` — Human Messages and Tool Results

User records serve double duty: they carry both the human's typed prompts and the results of tool executions. The `message.content` field distinguishes the two:

**Human prompt** — `content` is a string:
```jsonc
{
  "type": "user",
  "uuid": "faa0d041-...",
  "parentUuid": null,                   // null for the first message in a conversation
  "sessionId": "2b305e84-...",
  "timestamp": "2026-02-18T15:09:10.006Z",
  "version": "2.1.45",                  // Claude Code CLI version
  "cwd": "/Users/kevinpruett/code/fleet",
  "gitBranch": "main",
  "slug": "sequential-strolling-taco",  // human-readable session name
  "isSidechain": false,                 // true only in subagent files
  "userType": "external",
  "permissionMode": "bypassPermissions",
  "message": {
    "role": "user",
    "content": "verify assumptions made in @ARCHITECTURE.md..."
  },
  "todos": [],                          // active task list items, if any
  "thinkingMetadata": { "maxThinkingTokens": 31999 }
}
```

**Tool result** — `content` is an array of `tool_result` blocks:
```jsonc
{
  "type": "user",
  "uuid": "...",
  "parentUuid": "...",                  // links to the assistant message that made the tool call
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01Qvm...",  // matches the tool_use block's id
        "content": "file contents here...",
        "is_error": false
      }
    ]
  },
  "toolUseResult": {                    // metadata about the tool execution
    "status": "completed",
    "prompt": "...",                    // for Task tool: the prompt sent to the subagent
    "agentId": "a748733",              // for Task tool: links to subagent file
    "totalDurationMs": 61098,
    "totalTokens": 68154,
    "totalToolUseCount": 35,
    "usage": { ... }
  }
}
```

The `toolUseResult` field is especially important for subagent results — it carries the `agentId` that maps to the subagent's transcript file, plus aggregated cost/duration stats for the entire subagent run.

**Notable optional fields on user records:**
- `isMeta: true` — system-injected messages (local command caveats, skill expansions), not real human input
- `planContent` — when the user is in plan mode, the plan text is stored here separately from `message.content`
- `sourceToolUseID` — back-reference when the message was injected by the skill system
- `sourceToolAssistantUUID` — assistant message that triggered this injected message
- `todos` — array of `{ content, status, activeForm }` objects representing the active task list

### `assistant` — API Responses

Each API response generates **multiple JSONL records** — one per content block in the response. They share the same `message.id` (the API's message ID) but each gets a unique `uuid`. Records within a single API response are chained: `record1.uuid` becomes `record2.parentUuid`.

```jsonc
{
  "type": "assistant",
  "uuid": "bf96a1ae-...",
  "parentUuid": "40e59261-...",         // previous record (user message or prior assistant block)
  "sessionId": "8a6dc86d-...",
  "timestamp": "...",
  "requestId": "req_011CY5Lq...",      // API request ID
  "isSidechain": false,
  "message": {
    "model": "claude-opus-4-6",
    "id": "msg_015kDst...",             // API message ID (same across blocks in one response)
    "type": "message",
    "role": "assistant",
    "content": [                        // ONE content block per record
      {
        "type": "tool_use",
        "id": "toolu_012amo...",
        "name": "Read",
        "input": { "file_path": "/Users/kevinpruett/..." }
      }
    ],
    "stop_reason": null,                // observed to be null in JSONL (streaming artifact)
    "stop_sequence": null,
    "usage": {
      "input_tokens": 3,
      "output_tokens": 77,
      "cache_creation_input_tokens": 2872,
      "cache_read_input_tokens": 19205,
      "service_tier": "standard"
    }
  }
}
```

**Content block types in assistant messages:**
- `text` — prose response (`{ type: "text", text: "..." }`)
- `thinking` — extended thinking (`{ type: "thinking", thinking: "...", signature: "..." }`)
- `tool_use` — tool invocation (`{ type: "tool_use", id: "toolu_...", name: "Read", input: {...} }`)

**API error variant:** When the API returns an error, a synthetic assistant record is written with `isApiErrorMessage: true`, `model: "<synthetic>"`, and the error text in a `text` content block. These are not real API responses.

### `system` — Turn Metadata and Errors

System records carry metadata about turn execution. Three subtypes:

- **`turn_duration`** — emitted at the end of each turn. `parentUuid` references the assistant message, `durationMs` is wall-clock time for the turn.
- **`api_error`** — emitted on API retry. Carries `error`, `retryInMs`, `retryAttempt`, `maxRetries`.
- **`local_command`** — emitted when the user runs a slash command (e.g., `/config`, `/clear`). The command name and args are in an XML-tagged `content` string.

### `progress` — In-Flight Status Updates

Progress records are high-frequency updates written while tools are executing. Three subtypes distinguished by `data.type`:

- **`agent_progress`** — a subagent has started. Carries the full prompt sent to the agent and its `agentId`. `parentToolUseID` links to the `tool_use` block that spawned it.
- **`bash_progress`** — periodic output from a long-running bash command. Carries `output`, `fullOutput`, `elapsedTimeSeconds`.
- **`hook_progress`** — a PostToolUse hook fired. Carries `hookEvent`, `hookName`, `command`.

### `queue-operation` — Message Queue Events

Written when messages are queued for delivery to a waiting/resumed session. Two operations: `enqueue` (with `content` of the queued message) and `dequeue`. These have no `uuid` field — they are the only record type without one.

## Parent-Child Relationships

The transcript files encode two distinct parent-child relationships:

### 1. Record Chain (within a file)

Every record has a `parentUuid` field pointing to the previous record in the conversation. This forms a singly-linked list:

```
user₁ (parentUuid: null)                              ← first human message
  └─ assistant₁ (parentUuid: user₁.uuid)               ← first content block of response
       └─ assistant₂ (parentUuid: assistant₁.uuid)      ← same API response, next block
            └─ user₂ (parentUuid: assistant₂.uuid)      ← tool result
                 └─ assistant₃ (parentUuid: user₂.uuid)  ← next API response
```

The first human message in a session has `parentUuid: null`. Everything else chains off it. Within a single API response, assistant records chain to each other (one record per content block).

### 2. Session-to-Subagent (across files)

**There is no `parentSessionId` field.** The parent-child relationship between sessions is purely structural — encoded in the filesystem hierarchy:

```
{parentSessionId}.jsonl                          ← parent session
{parentSessionId}/subagents/agent-{agentId}.jsonl  ← child (subagent) session
```

The link is established through several correlated fields:

1. **Parent file:** An assistant record contains a `tool_use` block with `name: "Task"`. Its `id` (e.g., `toolu_019tRb...`) is the tool use that spawned the subagent.
2. **Parent file:** A `progress` record with `data.type: "agent_progress"` carries the `agentId` and `parentToolUseID`.
3. **Parent file:** When the subagent completes, a `user` record with `toolUseResult.agentId` carries the result and aggregated stats.
4. **Child file:** The subagent's transcript shares the same `sessionId` as the parent but has `isSidechain: true` and an `agentId` field on every record.

## Common Fields

Fields present on most record types:

| Field | Description |
|-------|-------------|
| `uuid` | Unique ID for this record (absent on `queue-operation`) |
| `parentUuid` | UUID of the previous record in the chain (`null` for first message) |
| `sessionId` | Session UUID — matches the `.jsonl` filename |
| `timestamp` | ISO 8601 timestamp |
| `isSidechain` | `false` for main sessions, `true` for subagent transcripts |
| `userType` | Always `"external"` in observed data |
| `cwd` | Working directory of the Claude process at time of record |
| `version` | Claude Code CLI version (e.g., `"2.1.45"`) |
| `gitBranch` | Git branch at time of record |
| `slug` | Human-readable session name (e.g., `"sequential-strolling-taco"`) |
