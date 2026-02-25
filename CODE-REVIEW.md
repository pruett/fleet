# Code Review: feat/arch-refactor

> Base: `origin/main` | Files changed: 24 | Reviewed: 2026-02-25

## Summary

Solid feature branch implementing client-side routing, worktree scanning, session pagination, and UI cleanup. The main concern is a lossy path-decoding step in the worktrees endpoint that will silently produce wrong filesystem paths for projects whose names contain hyphens. Several silently-swallowed errors and a test that doesn't exercise its stated filter are also worth addressing.

---

## Likely Bug

| # | File | Lines | Description | Fix |
|---|------|-------|-------------|-----|
| 1 | `src/api/create-app.ts` | 148 | `projectId.replaceAll("-", "/")` is a lossy decode — a project at `/Users/foo/my-project` has ID `-Users-foo-my-project`, which decodes to `/Users/foo/my/project`. `scanWorktrees` then scans the wrong path and silently returns `[]`. | Use the already-resolved `projectDir` from `resolveProjectDir` and derive the real project path from it (e.g., read a metadata file or use the `ProjectSummary.path` field), or add a shared `decodeProjectPath()` utility that handles the ambiguity the same way `scan-projects.ts` does. |

## Issue

| # | File | Lines | Description | Fix |
|---|------|-------|-------------|-----|
| 2 | `src/api/create-app.ts` | 148 | Path-decoding logic (`replaceAll("-", "/")`) is duplicated inline instead of sharing with `scan-projects.ts`. If the encoding convention changes, the two will diverge. | Extract a `decodeProjectId(id: string): string` helper and import it in both locations. |
| 3 | `client/src/views/DashboardView.tsx` | 102, 105 | `.catch(() => {})` on both `fetchSessions` and `fetchWorktrees` silently swallows all errors (network failures, 500s). The loading skeleton disappears but the user sees no data and no error indication. | At minimum, log the error or show a toast so the user knows something went wrong. |
| 4 | `src/scanner/__tests__/scan-worktrees.test.ts` | 24–32 | Test "skips non-directory entries in .worktrees/" claims the fixture contains `some-file.txt`, but the fixture only has subdirectories with `.gitkeep` inside them — there is no non-directory entry at the `.worktrees/` level, so the filter is never exercised. | Add an actual file (e.g., `.gitkeep` or `README`) directly inside `fixtures/worktree-project/.claude/.worktrees/` and verify it's excluded. |

## Nit

| # | File | Lines | Description | Fix |
|---|------|-------|-------------|-----|
| 5 | `client/src/views/DashboardView.tsx` | 375–379 | `projectId` prop is not passed to `<SessionPanel>`, so the `handleNewSession` handler inside `useSessionData` will silently no-op (guards on `if (!projectId) return`). The action bar that invoked it was removed in T-03, but if it's re-added the handler won't work. | Either pass `projectId` derived from the session cache, or remove the `projectId` prop and `handleNewSession` from the hook to avoid dead code. |
| 6 | `client/src/views/DashboardView.tsx` | 285–290 | `selectSession` → `onGoSession` → `handleNewSession` is a dead code path since T-03 removed the only UI that called it. | Remove `onGoSession` prop threading or mark it as intentionally kept for future use. |
| 7 | `src/api/create-app.ts` | 133 | `parseInt(limitParam, 10)` returns `NaN` for non-numeric strings. The `limit && limit > 0` guard catches it (NaN is falsy), but the intent would be clearer with an explicit `Number.isFinite` check. | `const limit = limitParam ? Number(limitParam) : undefined;` + `if (limit != null && Number.isFinite(limit) && limit > 0)` |
