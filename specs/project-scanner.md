# Project Scanner

Discovers projects and sessions from transcript stores, produces summary metadata. See [jsonl-transcript-spec.md](jsonl-transcript-spec.md) for the JSONL format, [transcript-parser.md](transcript-parser.md) for full parsing, [ARCHITECTURE.md](../ARCHITECTURE.md) for system context.

## Functions

```
scanProjects(basePaths: string[]) -> ProjectSummary[]
```

Scans one or more base directories for project dirs. Returns merged results sorted by `lastActiveAt` descending. Default base path: `~/.claude/projects/`.

```
scanSessions(projectDir: string) -> SessionSummary[]
```

Scans a single project directory for session files. Returns results sorted by `lastActiveAt` descending.

## Base Paths

`scanProjects` accepts an array — not a single path. This decouples Fleet from Claude Code's specific storage location and supports custom directories, multiple transcript sources, and test fixtures. The default is `["~/.claude/projects/"]`. Each path is scanned independently; results are merged. Duplicate project directory names across base paths are treated as separate projects (distinguished by `source`). Missing or unreadable paths are silently skipped.

## Discovery Rules

### Projects

```
for each entry in basePath:
  skip if not a directory
  skip if name is "memory" or starts with "."
  -> project directory
```

**Path decoding:** directory name `-Users-foo-code-bar` → display path `/Users/foo/code/bar` (replace `-` with `/`). Lossy — hyphens in original paths are ambiguous. Raw directory name is the canonical ID.

### Sessions

```
for each entry in projectDir:          (non-recursive)
  skip if directory
  skip if not .jsonl
  skip if filename is not a valid UUID
  -> session file
```

Subagent files are excluded implicitly — they live in subdirectories.

## Summary Extraction

No full parse. Reads selectively per session file:

| What | Where | Fields extracted |
|------|-------|-----------------|
| Header | First lines until first non-meta `user` record | `sessionId`, `slug`, `firstPrompt`, `startedAt`, `cwd`, `gitBranch` |
| Usage | All `assistant` records, deduplicated by `message.id` (keep last block per response) | `model`, `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `cost` |
| Recency | Last line of file | `lastActiveAt` |

Token deduplication matches the parser's logic — see [transcript-parser.md](transcript-parser.md#token-aggregation).

## Data Structures

### `ProjectSummary`

```
{
  id:           string        // raw directory name: "-Users-foo-code-bar"
  source:       string        // base path it was found under
  path:         string        // decoded display path: "/Users/foo/code/bar"
  sessionCount: number        // top-level .jsonl files only
  lastActiveAt: string | null // ISO 8601, from most recent session
}
```

### `SessionSummary`

```
{
  sessionId:           string        // UUID from filename
  slug:                string | null // human-readable name
  firstPrompt:         string | null // first non-meta user message, truncated
  model:               string | null // e.g. "claude-opus-4-6"
  startedAt:           string | null // ISO 8601
  lastActiveAt:        string | null // ISO 8601
  cwd:                 string | null // working directory at session start
  gitBranch:           string | null // branch at session start
  inputTokens:         number        // deduplicated by response
  outputTokens:        number        // deduplicated by response
  cacheCreationTokens: number
  cacheReadTokens:     number
  cost:                number        // USD
}
```

Nullable fields default to `null`, numeric fields to `0` when data is missing or malformed.

## Verification

1. Given N projects and M sessions, returns exactly N `ProjectSummary` and M total `SessionSummary` entries
2. `cost` matches manual sum: deduplicate assistant records by `message.id`, apply model pricing
3. New `.jsonl` file appears on next scan
4. Empty project dir → `sessionCount: 0`, `lastActiveAt: null`
5. Malformed file → nulls and zeros, no throw
6. Subagent files never appear in results
7. Snapshot-only session → `firstPrompt: null`, `model: null`, zero tokens
8. Same directory name under different base paths → separate projects (different `source`)
9. Missing base path → silently skipped
