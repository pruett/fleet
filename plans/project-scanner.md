# Implementation Plan: Project Scanner

> Source: `specs/project-scanner.md`
> Generated: 2026-02-20

> **Assumption:** The transcript parser (currently in worktree `feat-transcript-parser`) will be merged to `main` before or alongside this work. The scanner imports `computeCost` from `src/parser/pricing.ts`.

> **Assumption:** The scanner reads JSONL files using lightweight selective parsing (quick JSON.parse + field checks), not the full Zod-validated `parseLine` pipeline. This keeps it fast for directory-level scans.

---

## Phase 0 — Tracer Bullet
> Scan one base path, find one project with one session file, return `ProjectSummary` and `SessionSummary` with basic header fields.

### Project Scaffolding + Types
- [x] Create `src/scanner/types.ts` — `ProjectSummary` and `SessionSummary` interfaces matching the spec
- [x] Create `src/scanner/index.ts` — placeholder public API re-exports
- [x] Create `src/scanner/__tests__/fixtures/` directory with a minimal test transcript store layout (one project dir containing one `.jsonl` file with 4 lines: snapshot, user prompt, assistant text, system turn_duration)

### Minimal scanProjects + scanSessions
- [x] Create `src/scanner/scan-projects.ts` — `scanProjects(basePaths)`: iterate base paths, read directory entries, skip non-dirs / `memory` / dot-prefixed, decode path (replace leading `-` then all `-` with `/`), return `ProjectSummary[]` sorted by `lastActiveAt` desc
- [x] Create `src/scanner/scan-sessions.ts` — `scanSessions(projectDir)`: read directory entries, skip dirs, skip non-`.jsonl`, skip non-UUID filenames, return `SessionSummary[]` sorted by `lastActiveAt` desc
- [x] Create `src/scanner/extract-session-summary.ts` — reads a single `.jsonl` file selectively: header lines for `sessionId`/`slug`/`firstPrompt`/`startedAt`/`cwd`/`gitBranch`, last line for `lastActiveAt`, stub zeros for token fields
- [ ] Create `src/scanner/__tests__/scan-projects.test.ts` — scan fixture base path, verify 1 project with correct `id`, `path`, `source`, `sessionCount`, `lastActiveAt`
- [ ] Create `src/scanner/__tests__/scan-sessions.test.ts` — scan fixture project dir, verify 1 session with correct `sessionId`, `slug`, `firstPrompt`, `startedAt`, `lastActiveAt`
- [ ] **Verify:** `bun test src/scanner` passes end-to-end

---

## Phase 1 — Core: Token Aggregation + Cost

### Usage Extraction with Deduplication
- [ ] Extend `extract-session-summary.ts` — scan all lines, for each `"type":"assistant"` line: parse JSON, extract `message.id`, `message.model`, `message.usage`; deduplicate by `message.id` keeping last occurrence per response
- [ ] Sum deduplicated usage across all responses: `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`
- [ ] Import `computeCost` from `src/parser/pricing.ts` to calculate `cost` from deduplicated per-response usage
- [ ] Extract `model` from the first assistant record encountered

### Usage Tests
- [ ] Create fixture with multi-block response (3 assistant lines sharing same `message.id` with different usage values) — verify only last block's usage counted
- [ ] Create fixture with multiple responses (2 different `message.id`s) — verify usage summed across both
- [ ] Test: `cost` matches manual computation via pricing table for a known model
- [ ] Test: unknown model → `cost: 0`, tokens still summed correctly
- [ ] **Verify:** `bun test src/scanner` passes

---

## Phase 2 — Edge Cases & Validation

### Header Extraction Edge Cases
- [ ] Handle meta-only user records (`isMeta: true`) — skip when looking for `firstPrompt`, continue until first non-meta user with string content
- [ ] Handle `firstPrompt` truncation (spec says "truncated" — truncate to 200 chars)
- [ ] Test: session with only meta prompts → `firstPrompt: null`
- [ ] Test: session with snapshot only (no user record) → `firstPrompt: null`, `model: null`, zero tokens

### File & Directory Filtering
- [ ] Test: directories inside project dir are skipped (subagent companion dirs)
- [ ] Test: non-`.jsonl` files are skipped
- [ ] Test: files with non-UUID names are skipped (e.g., `notes.jsonl`, `memory.jsonl`)
- [ ] Test: `memory` directory under base path is skipped
- [ ] Test: dot-prefixed directories under base path are skipped (e.g., `.git`)

### Resilience
- [ ] Malformed JSON lines → silently skip (no throw), fields remain null/zero
- [ ] Empty `.jsonl` file → all nullable fields `null`, all numeric fields `0`
- [ ] Completely empty project directory → `sessionCount: 0`, `lastActiveAt: null`
- [ ] Missing or unreadable base path → silently skipped, no throw
- [ ] Test: mixed valid and malformed lines produce correct partial results

---

## Phase 3 — Multi-Source + Sorting + Public API

### Multiple Base Paths
- [ ] Create fixture with two base paths, each containing projects (including one with the same directory name)
- [ ] Test: same directory name under different base paths → separate `ProjectSummary` entries with different `source`
- [ ] Test: results merged and sorted by `lastActiveAt` descending across all base paths
- [ ] Test: one missing base path + one valid → returns results from valid path only

### Sorting
- [ ] Test: `scanProjects` returns projects sorted by `lastActiveAt` desc (most recent first)
- [ ] Test: `scanSessions` returns sessions sorted by `lastActiveAt` desc
- [ ] Test: project with `null` `lastActiveAt` (empty project) sorts last

### Public API + Exports
- [ ] Wire up `src/scanner/index.ts` — export `scanProjects`, `scanSessions`, `ProjectSummary`, `SessionSummary`
- [ ] Test: import from `src/scanner/index.ts`, verify both functions callable
- [ ] **Verify:** `bun test` passes (all scanner + parser tests), `bun run typecheck` passes

## Directory Structure

```
src/
  scanner/
    types.ts                       # ProjectSummary, SessionSummary
    scan-projects.ts               # scanProjects()
    scan-sessions.ts               # scanSessions()
    extract-session-summary.ts     # selective JSONL reading
    index.ts                       # public re-exports
  scanner/__tests__/
    fixtures/                      # test transcript store layouts
    scan-projects.test.ts
    scan-sessions.test.ts
    extract-session-summary.test.ts
```
