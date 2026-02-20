# Transcript Parser — Implementation Plan

## Context

Fleet is a real-time dashboard for monitoring Claude Code sessions. The transcript parser is its core data processing component, transforming append-only JSONL session files into structured, analytics-ready data. This is a **greenfield project** — no source code exists yet, only specs (`docs/transcript-parser.md`, `docs/jsonl-transcript-spec.md`, `ARCHITECTURE.md`).

The parser exposes three pure functions:
- `parseLine` — classify one JSONL line into a typed `ParsedMessage`
- `enrichSession` — build cross-message structures (turns, responses, tool pairings, stats)
- `parseFullSession` — compose both

## Directory Structure

```
package.json
tsconfig.json
src/
  parser/
    schemas.ts               # Zod schemas for raw JSONL records + parsed message types
    types.ts                 # TypeScript types inferred from Zod schemas (z.infer)
    parse-line.ts            # parseLine function (validates via Zod schemas)
    enrich-session.ts        # enrichSession function
    parse-full-session.ts    # parseFullSession composition
    pricing.ts               # Model pricing table for cost computation
    index.ts                 # Public API re-exports
  parser/__tests__/
    helpers.ts               # Fixture builder functions
    fixtures/                # .jsonl test fixtures
    schemas.test.ts          # Schema validation tests (accept/reject)
    parse-line.test.ts
    enrich-session.test.ts
    parse-full-session.test.ts
```

## Implementation Checklist

### Unit 0 — Project Scaffolding ✅
- [x] Create `package.json` (name: `fleet`, type: `module`, scripts: `test` → `bun test`, `typecheck` → `tsc --noEmit`)
- [x] `bun add zod`
- [x] Create `tsconfig.json` (strict, `moduleResolution: "bundler"`, `target: "esnext"`, Bun types)
- [x] Create placeholder `src/parser/index.ts`
- [x] Create smoke test `src/parser/__tests__/smoke.test.ts`
- [x] **Verify:** `bun test` passes, `bun run typecheck` passes

### Unit 1 — Zod Schemas + Inferred Types ✅
Zod schemas are the **single source of truth** for all data shapes. TypeScript types are derived via `z.infer<>` — no manual interface duplication.

**`src/parser/schemas.ts`** — Raw JSONL record schemas (what arrives from disk):
- [x] Define `CommonFieldsSchema` — `z.object({ uuid: z.string(), parentUuid: z.string().nullable(), sessionId: z.string(), timestamp: z.string() })`
- [x] Define a `RawRecordSchema` — a top-level discriminated union (`z.discriminatedUnion("type", [...])`) over the 6 raw JSONL record types:
  - `FileHistorySnapshotRecordSchema` — `type: "file-history-snapshot"`, snapshot, isSnapshotUpdate
  - `UserRecordSchema` — `type: "user"`, message with content (string | array via `z.union`)
  - `AssistantRecordSchema` — `type: "assistant"`, message with id, model, content blocks, usage
  - `SystemRecordSchema` — `type: "system"`, subtype discriminator, variant fields
  - `ProgressRecordSchema` — `type: "progress"`, data with nested type discriminator
  - `QueueOperationRecordSchema` — `type: "queue-operation"`, operation, content
- [x] Define `ContentBlockSchema` — `z.discriminatedUnion("type", [TextBlockSchema, ThinkingBlockSchema, ToolUseBlockSchema])`
- [x] Define `TokenUsageSchema` — input_tokens, output_tokens, cache tokens

**`src/parser/schemas.ts`** — Parsed message schemas (what `parseLine` outputs):
- [x] Define schemas for all 12 parsed message kinds, each with a `kind` literal discriminator
- [x] Define `ParsedMessageSchema` as `z.discriminatedUnion("kind", [...])`

**`src/parser/types.ts`** — Inferred types + enrichment types:
- [x] Export `type ParsedMessage = z.infer<typeof ParsedMessageSchema>` and each variant type
- [x] Define enrichment output types manually (not Zod — these are internal structures, not validated from external input): `Turn`, `ReconstitutedResponse`, `PairedToolCall`, `TokenTotals`, `ToolStat`, `SubagentRef`, `ContextSnapshot`, `EnrichedSession`

**`src/parser/__tests__/schemas.test.ts`** — Schema validation tests:
- [x] Test: each raw record schema **accepts** a valid record and returns typed data
- [x] Test: each raw record schema **rejects** a record with missing required fields (Zod error)
- [x] Test: each raw record schema **rejects** a record with wrong field types
- [x] Test: `ContentBlockSchema` accepts text, thinking, tool_use; rejects unknown type
- [x] Test: `RawRecordSchema` discriminates correctly on the `type` field
- [x] **Verify:** `bun run typecheck` passes, `bun test` passes

### Unit 2 — TRACER BULLET: Minimal End-to-End ✅
**First priority. Exercises the full pipeline with the simplest real session.**

- [x] Create fixture `minimal-session.jsonl` (4 lines: file-history-snapshot, user prompt, assistant text, turn_duration)
- [x] Create test helper `helpers.ts` with fixture builder functions (`makeUserPrompt`, `makeAssistantBlock`, etc.)
- [x] Implement `parseLine` with 4 handlers: file-history-snapshot, user (string content), assistant (text block), system (turn_duration). Uses Zod `.safeParse()` to validate each line — on `success: false`, returns `MalformedRecord` with Zod error details. Invalid JSON / blank → `null` / `MalformedRecord`.
- [x] Implement `enrichSession` with: turn construction, single-block response reconstitution, basic token totals. Return empty stubs for toolCalls, toolStats, subagents, contextSnapshots.
- [x] Implement `parseFullSession` — split on `\n`, filter empty, map through `parseLine`, filter null, pass to `enrichSession`.
- [x] Tests:
  - Parses all 4 lines with correct `kind` values
  - Constructs exactly 1 turn with correct prompt text and durationMs
  - Reconstitutes 1 response with 1 text block and correct messageId
  - Computes basic token totals (inputTokens: 10, outputTokens: 20)
  - Empty enrichments for unimplemented features
- [x] **Verify:** `bun test` passes end-to-end

### Unit 3 — parseLine: User Tool Result ✅
- [x] Handle `user` with array content → `UserToolResultMessage`
- [x] Extract `results[]` (toolUseId, content, isError) and `toolUseResult` metadata
- [x] Tests: happy path, `is_error: true`, `toolUseResult` with `agentId`

### Unit 4 — parseLine: Assistant Block Variants ✅
- [x] Handle `thinking` and `tool_use` content blocks in assistant records
- [x] Handle synthetic assistant records (`isApiErrorMessage: true`)
- [x] Tests: thinking block extraction, tool_use field extraction, synthetic flag

### Unit 5 — parseLine: System Subtypes ✅
- [x] Handle `api_error` → `SystemApiErrorMessage` (error, retryInMs, retryAttempt, maxRetries)
- [x] Handle `local_command` → `SystemLocalCommandMessage` (content)
- [x] Tests: field extraction for each, unknown subtype → `MalformedRecord`

### Unit 6 — parseLine: Progress Subtypes ✅
- [x] Handle `agent_progress` → `ProgressAgentMessage` (agentId, prompt, parentToolUseID)
- [x] Handle `bash_progress` → `ProgressBashMessage` (output, elapsedTimeSeconds)
- [x] Handle `hook_progress` → `ProgressHookMessage` (hookEvent, hookName, command)
- [x] Tests: field extraction for each, unknown `data.type` → `MalformedRecord`

### Unit 7 — parseLine: Queue Operation + Edge Cases ✅
- [x] Handle `queue-operation` → `QueueOperationMessage` (operation, content)
- [x] Tests: enqueue/dequeue, edge cases: empty string → null, invalid JSON → MalformedRecord, missing `type` → MalformedRecord, unknown type → MalformedRecord, parseLine never throws
- [x] Test: Zod validation rejects structurally valid JSON that's missing required fields (e.g. assistant record without `message.id`) — verify MalformedRecord contains Zod error path
- [x] **Milestone: parseLine is complete — all 12 message kinds classified, all validated via Zod**

### Unit 8 — enrichSession: Multi-Block Response Reconstitution ✅
- [x] Group assistant blocks by `messageId`, order by lineIndex
- [x] Take usage from last block per response
- [x] Create fixture with 3-block response (thinking, text, tool_use sharing same messageId)
- [x] Tests: 3 blocks → 1 response, 2 different messageIds → 2 responses, usage from last block, synthetic handling

### Unit 9 — enrichSession: Tool Call Pairing
- [ ] Match `tool_use` blocks with `tool_result` items by toolUseId
- [ ] Create fixture with tool call cycle (prompt → tool_use → tool_result → text → turn_duration)
- [ ] Tests: successful pairing, error pairing, unmatched tool_use → `toolResultBlock: null`, correct turnIndex, toolUseCount in totals

### Unit 10 — enrichSession: Token Aggregation + Cost
- [ ] Deduplicate tokens by messageId (keep last block per response)
- [ ] Sum across all responses
- [ ] Create `pricing.ts` with model pricing table
- [ ] Tests: deduplication, summation, cost for known models, unknown model → cost 0, cache token aggregation

### Unit 11 — enrichSession: Tool Statistics
- [ ] Count calls, errors, errorSamples per tool name from paired tool calls
- [ ] Tests: mixed success/error counts, error text extraction, correct turnIndex on samples

### Unit 12 — enrichSession: Context Snapshots
- [ ] After each non-synthetic response, record cumulative token snapshot
- [ ] Tests: correct count (skip synthetic), cumulative output sum, correct messageId/turnIndex

### Unit 13 — enrichSession: Subagent References
- [ ] Correlate Task tool_use blocks + progress-agent messages + tool results with `toolUseResult.agentId`
- [ ] Create fixture with subagent spawn cycle
- [ ] Tests: correct agentId/prompt/parentToolUseID, stats from toolUseResult, still-running subagent → stats: null

### Unit 14 — Integration: Multi-Turn Session
- [ ] Create 3-turn fixture exercising all enrichments together
- [ ] Tests: 3 turns with correct prompts/durations, response counts per turn, tool pairing across turns, aggregate totals, tool stats, context snapshot count
- [ ] **Milestone: enrichSession is complete — all 7 enrichments working**

### Unit 15 — parseFullSession: Edge Cases
- [ ] Tests: empty string → empty session, blank lines only, malformed lines mixed with valid, no human prompt → 0 turns, meta-only prompts → 0 turns, single snapshot line, very long lines

### Unit 16 — parseLine: Comprehensive Unit Tests
- [ ] Dedicated `parse-line.test.ts` with one `describe` block per message kind (12 blocks)
- [ ] Tests: happy-path all fields, missing optional fields default correctly, minimal valid input

### Unit 17 — Public API and Exports
- [ ] Wire up `src/parser/index.ts` to export all functions and types
- [ ] Tests: import from index, verify all 3 functions callable

## Key Design Decisions

- **Zod as single source of truth** — All raw JSONL record shapes and parsed message shapes are defined as Zod schemas in `schemas.ts`. TypeScript types are inferred via `z.infer<>`, eliminating duplication between runtime validation and compile-time types.
- **Strict schema validation** — `parseLine` uses `schema.safeParse()` on every line. Any field that's missing, wrong type, or structurally invalid produces a `MalformedRecord` with the Zod error path and message. No silent data loss.
- **`kind` discriminator** on all ParsedMessage types enables exhaustive switch/case in consumers
- **parseLine never throws** — JSON.parse is wrapped in try/catch, Zod `.safeParse()` never throws. Both failure modes produce `MalformedRecord`.
- **Enrichment types are plain TypeScript** — Only types representing external input (JSONL records) get Zod schemas. Internal structures (`Turn`, `EnrichedSession`, etc.) are manual interfaces since they're constructed by our own code, not validated from untrusted input.
- **Enrichment ordering** in `enrichSession`: turns → response reconstitution → tool pairing → token aggregation → tool stats → subagent refs → context snapshots (each step depends on prior)
- **Pricing table** starts with known models (sonnet, opus, haiku); unknown models → cost 0
- **Test fixtures**: both `.jsonl` files and builder functions in `helpers.ts` for programmatic construction

## Verification

After all units complete:
1. `bun test` — all tests pass
2. `bun run typecheck` — no type errors
3. Feed a real Claude Code session JSONL through `parseFullSession` and inspect output
