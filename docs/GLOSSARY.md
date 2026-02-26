**Project.** A logical grouping of sessions that share a common name. A project can contain references to mulitple working directories. A project contains zero or more session files and an optional `memory/` directory.

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
