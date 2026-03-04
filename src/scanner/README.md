# Scanner Module

Traverses transcript directories to enumerate projects, sessions, and worktrees.

## Public Interface

### Functions

- **`scanProjects(basePaths: string[]): Promise<ProjectSummary[]>`** — Scans base directories for projects. Returns summaries sorted by `lastActiveAt` descending.
- **`scanSessions(projectDir: string): Promise<SessionSummary[]>`** — Scans a project directory for `.jsonl` session files. Returns summaries sorted by `lastActiveAt` descending.
- **`groupProjects(rawProjects, configs): GroupedProject[]`** — Groups raw project directories into logical projects based on glob patterns from config.
- **`scanWorktrees(projectPath: string): Promise<WorktreeSummary[]>`** — Scans a project for git worktrees. Returns linked worktree summaries sorted alphabetically.

Types used by this module (`ProjectSummary`, `SessionSummary`, `GroupedProject`, `WorktreeSummary`) are defined in `@fleet/shared`.
