# Architecture of Fleet

## System Overview

Fleet is a real-time dashboard for monitoring and controlling Claude Code sessions. Its sole external dependency is the set of append-only JSONL transcript files that the Claude Code CLI writes to a well-known directory on the local filesystem. Fleet reads those files, parses them into structured analytics-ready data, and presents a live web interface. It can also spawn CLI subprocesses to start, resume, stop, and message sessions from the browser.

## Glossary

**Project.** A logical grouping of sessions that share a working directory. Encoded as a directory under the transcript store base path, with the original filesystem path flattened (slashes replaced by hyphens). A project contains zero or more session files and an optional `memory/` directory.

**Session.** A single Claude Code CLI execution, identified by a UUID v4. Each session produces exactly one append-only JSONL transcript file (`{sessionId}.jsonl`). A session may spawn child sessions (subagents) whose transcripts live in a companion directory alongside the parent file.

**Transcript.** The JSONL file that captures everything that happened during a session. Each line is a self-contained JSON record. Transcripts are append-only — records are written sequentially and never modified. "Transcript" refers to the file artifact; "session" refers to the execution context it represents.

**Record.** A single JSON line in a transcript file, classified by its `type` field. Six record types exist: `file-history-snapshot`, `user`, `assistant`, `system`, `progress`, and `queue-operation`. Records are linked into a singly-linked list via `parentUuid` chains.

**Message.** The typed, classified representation of a record after parsing. The parser reads a raw JSON line and produces a message with a specific kind (e.g., `user-human-prompt`, `assistant-block`, `system-api-error`). Twelve message kinds exist. "Record" is raw JSON; "message" is the parsed, validated object.

**Turn.** A logical conversation unit that begins with a non-meta human prompt and spans all subsequent records until the next human prompt. A turn groups together the user's input, all assistant responses, tool calls, and system metadata that result from that input. Turns are computed during enrichment, not stored in the raw transcript.

**Response.** A reconstituted API response assembled from multiple consecutive `assistant` records that share the same `message.id`. The Claude API returns responses containing multiple content blocks, but the CLI writes one record per block. The parser merges them back into a single logical response with an ordered list of content blocks and aggregated token usage.

**Content Block.** A single element within an API response. Three types: text (prose output), thinking (extended thinking output), and tool_use (a request to invoke a tool). Each content block is written as its own `assistant` record in the transcript.

**Tool Call.** A paired tool_use content block and its corresponding tool_result, matched by `toolUseId`. Represents a complete tool invocation cycle: the model's request to use a tool and the tool's returned output. A tool call may be unmatched if the session ended before the tool produced a result.

**Subagent.** A child session spawned by a parent session via the `Task` tool. Subagent transcripts live in `{parentSessionId}/subagents/agent-{agentId}.jsonl`. The parent-child relationship is encoded structurally in the filesystem hierarchy. All records in a subagent transcript have `isSidechain: true`.

**Enriched Session.** The fully parsed, cross-message data structure produced by a full parse of a transcript. Contains the raw message list plus computed enrichments: turn groupings, reconstituted responses, paired tool calls, aggregated token totals and cost, per-tool statistics, subagent references, and context window snapshots.

**Context Snapshot.** A point-in-time capture of token usage recorded at each response boundary. Tracks input tokens, output tokens, and cache tokens to visualize how the context window fills over the course of a session.

## Data Source

Fleet consumes append-only JSONL files written by the Claude Code CLI to a well-known base directory. The directory structure encodes project identity and session identity:

```
{base}/{encoded-project-path}/{session-id}.jsonl
```

Each line in a session file is a self-contained JSON object with a `type` field. Six record types exist: `file-history-snapshot`, `user`, `assistant`, `system`, `progress`, and `queue-operation`. Records are linked via `parentUuid` chains that form a singly-linked list within each file.

Subagent transcripts live in companion directories alongside the parent session file. The parent-child relationship between sessions is encoded structurally in the filesystem hierarchy, not via a field.

For the full format specification with JSON examples, field tables, and parent-child relationship details, see [docs/jsonl-transcript-spec.md](docs/jsonl-transcript-spec.md).

## Components

### 1. Project Scanner

**Responsibility:** Enumerate all projects and sessions from the transcript store, producing summary metadata for each.

**Behavior:**
- Discovers project directories and session files by traversing the directory structure
- Extracts summary data from each session file (first user prompt, token totals, cost, model)
- Returns results sorted by recency

For the full specification see [specs/project-scanner.md](specs/project-scanner.md).


### 2. Transcript Parser

**Responsibility:** Full-parse a session file into an enriched, type-checked data structure

**Behavior:**
- Parses each line as JSON, classifies by `type` field
- Normalizes content blocks into uniform shapes (e.g., tool result content may be a string or an array)
- Aggregates tokens and computes cost from `usage` fields on assistant records
- Derives enrichments: turn boundaries (each user message starts a new turn), tool call statistics with error attribution, subagent info from agent-spawning tool calls, context window utilization snapshots

For the full parser specification with data shapes, enrichment logic, edge cases, and verification scenarios, see [specs/transcript-parser.md](specs/transcript-parser.md).

### 3. File Watcher

**Responsibility:** Tail transcript files by byte offset, delivering batches of newly parsed messages to listeners.

**Inputs:** A session file path and the current byte offset (initialized to the file size at watch-start).

**Outputs:** Batched arrays of parsed messages, emitted as events.

**Behavior:**
- Maintains a byte offset per watched file; only reads bytes beyond that offset
- On each filesystem change event, eagerly reads new bytes immediately (OS-level event coalescing may merge multiple writes into one notification)
- Splits raw bytes on newline boundaries, buffering any incomplete trailing line for the next read
- Hands complete lines to the parser to produce typed messages
- Flushes parsed messages to listeners using a two-phase debounce: a short trailing-edge timer (resets on each new write) plus a max-wait ceiling (fires even if writes are still arriving)

**Verification:**
- After N bytes are appended to a file, the watcher reads exactly N new bytes and produces the correct messages
- Rapid sequential appends (simulating burst writes) are coalesced into batched flushes
- An incomplete trailing line is buffered and correctly joined with the next append
- Stopping the watcher for a session produces no further events for that session

### 4. API Layer

**Responsibility:** Serve request/response endpoints for data retrieval and session control.

**Inputs:** Client requests (list projects, list sessions, get session detail, start/stop/resume/send message).

**Outputs:** Structured responses (project lists, session summaries, enriched session data, control acknowledgments).

**Behavior:**
- Project and session listing endpoints delegate to the Project Scanner
- Session detail endpoint delegates to the Transcript Parser for a full parse
- Control endpoints delegate to the Session Controller
- Serves the client application's static assets in production

**Verification:**
- Listing projects returns the same data as the scanner
- Getting a session returns a fully enriched session object that matches a manual parse of the file
- Control endpoints correctly proxy to the controller and return appropriate success/error responses

### 5. Real-time Transport

**Responsibility:** Maintain persistent bidirectional connections with clients, relaying watcher and controller events.

**Inputs:** File Watcher events (new messages for a session) and Session Controller events (lifecycle changes).

**Outputs:** Pushed messages to subscribed clients.

**Behavior:**
- Each connected client is assigned a unique ID and tracked
- Clients subscribe to a specific session to receive its live message updates
- Watcher events are delivered only to clients subscribed to the matching session
- Controller lifecycle events are broadcast to all connected clients regardless of subscription
- Unsubscribe or disconnect triggers cleanup, stopping the watcher if no other clients are watching that session

**Verification:**
- A subscribed client receives all messages appended to the session file after subscribing
- An unsubscribed client receives no session-specific messages
- All clients receive controller lifecycle events regardless of subscription
- Disconnecting the last subscriber for a session stops the watcher for that session

### 6. Client Application

**Responsibility:** Present the dashboard UI for project browsing, session viewing, analytics, and session control.

**Inputs:** Enriched session data from the API Layer, real-time message deltas from the Real-time Transport.

**Outputs:** Rendered UI with interactive controls.

**Behavior:**
- Displays a project list, navigable to per-project session lists, navigable to individual session views
- On opening a session, fetches the full enriched session via the API, then subscribes to live updates via the real-time transport
- Renders conversation messages, tool calls, thinking blocks, and code with syntax highlighting
- Displays analytics panels: token usage, cost, context window utilization, turn timeline, tool statistics
- Provides session control: start new sessions, stop/resume running ones, send messages

**Verification:**
- Opening a session displays all messages present in the transcript file at that moment
- New messages appended to the file appear in the UI within ~1 second
- Analytics totals match the enriched session data from the API
- Session control actions produce the expected state transitions in the controller

## Data Flow

Three primary data flows connect the components:

**Full session load:**
Client → API Layer → Transcript Parser → EnrichedSession → Client

When a user opens a session, the client requests the full session from the API. The API delegates to the parser, which reads and parses the entire JSONL file, returning an enriched session object with messages, turns, token totals, tool stats, and context window history.

**Live updates:**
CLI writes → File Watcher → Transcript Parser → ParsedMessage[] → Real-time Transport → Client

While a session is open, the file watcher detects new bytes appended by the CLI, parses them into messages, and flushes batches through the real-time transport to all subscribed clients.

**Session control:**
Client → API Layer → Session Controller → CLI subprocess → File Watcher → Real-time Transport → Client

When a user starts, stops, resumes, or messages a session, the command flows through the API to the controller, which manages the CLI subprocess. The subprocess writes to the transcript file, which the watcher picks up and delivers back through the transport — closing the loop.

## Verification Strategy

System-level integration tests that verify components work together correctly:

1. **End-to-end live update pipeline.** Append known JSONL lines to a session file and verify the client receives the corresponding parsed messages within the latency target.
2. **Full-parse vs. incremental-parse consistency.** For any session file, verify that a full parse produces the same messages as replaying all incremental watcher batches from byte zero.
3. **Session control round-trip.** Start a session via the API, verify the subprocess is running, send a message, verify the response appears in the transcript file and is delivered to the client.
4. **Scanner accuracy.** Given a directory with a known set of projects and sessions, verify the scanner produces the exact expected project list and session summaries.
5. **Watcher resilience under burst writes.** Rapidly append many lines to a file and verify all lines are delivered (none lost) and that batching keeps event count within expected bounds.
6. **Reconnection recovery.** Disconnect a client, append lines during the disconnection, reconnect, and verify the client can recover the full current state (via a fresh full-parse) without data loss.
