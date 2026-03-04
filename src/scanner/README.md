# Scanner Module

Traverses transcript directories to enumerate projects, sessions, and worktrees.

## Public Interface

### Functions

- **`scanProjects(basePaths: string[]): Promise<ProjectSummary[]>`** — Scans base directories for projects. Returns summaries sorted by `lastActiveAt` descending.
- **`scanSessions(projectDir: string): Promise<SessionSummary[]>`** — Scans a project directory for `.jsonl` session files. Returns summaries sorted by `lastActiveAt` descending.
- **`groupProjects(rawProjects, configs): GroupedProject[]`** — Groups raw project directories into logical projects based on glob patterns from config.
- **`scanWorktrees(projectPath: string): Promise<WorktreeSummary[]>`** — Scans a project for git worktrees. Returns linked worktree summaries sorted alphabetically.

### Types

- **`ProjectSummary`** — Metadata for a discovered project directory.
- **`SessionSummary`** — Metadata for a discovered session file.
- **`GroupedProject`** — Aggregated project with matched directories, session counts, and timestamps.
- **`WorktreeSummary`** — Metadata for a git worktree.
