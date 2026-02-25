# Implementation Plan: Fleet Dashboard Improvements

> Source: `PRD.md`
> Generated: 2026-02-25

---

## Phase 0 — Tracer Bullets
> Two independent subsystems: client-side routing (T-01) and worktree scanning (T-02). Each gets a minimal end-to-end slice.

### Tracer Bullet A: Client-Side Routing (T-01)
- [x] Install `react-router` (or TanStack Router) in `client/package.json` via `bun add`
- [x] Replace the `window.location.replace("/")` redirect in `client/src/App.tsx` (lines 6–9) with a `BrowserRouter` + `Routes` definition for `/`, `/session/:sessionId`, and a `*` catch-all 404 route
- [x] In `client/src/views/DashboardView.tsx`, replace `parseEmbeddedSessionId()` (line 44) and `history.pushState` (line 219) with `useParams` and `useNavigate` from the router
- [x] Remove the `popstate` event listener (lines 211–217 of `DashboardView.tsx`) — the router handles back/forward natively
- [x] Verify deep-linking to `/session/:sessionId` works on first load (server SPA catch-all in `src/api/create-app.ts` already serves `index.html`)

### Tracer Bullet B: Worktree Scanning (T-02)
- [x] Add a `WorktreeSummary` type to `src/scanner/types.ts` (directory name, path)
- [x] Create `src/scanner/scan-worktrees.ts` — scan `<projectDir>/.claude/.worktrees/` for subdirectories
- [x] Add `GET /api/projects/:projectId/worktrees` endpoint in `src/api/create-app.ts`
- [x] Add `fetchWorktrees(projectId)` to `client/src/lib/api.ts`
- [x] Display worktree list in `ProjectTreeItem` (`client/src/views/DashboardView.tsx`) using the sidebar layout described below

---

## Phase 1 — Core UI Changes

### Remove Action Bar (T-03)
- [x] Delete the Stop/Resume/New Session button bar in `client/src/views/SessionPanel.tsx` (lines 227–255)

### Analytics Sheet (T-04)
- [x] Change `analyticsOpen` default from `true` to `false` in `client/src/hooks/use-session-data.ts` (line 130)
- [x] In `client/src/views/SessionPanel.tsx`, replace the inline grid column for `AnalyticsPanel` (line 261 `gridTemplateColumns`) with a `Sheet` component from `client/src/components/ui/sheet.tsx` using `side="right"`
- [x] Wire the existing analytics toggle button (lines 191–224 of `SessionPanel.tsx`) as a `SheetTrigger`
- [x] Ensure the transcript area uses full width (`1fr`) when the Sheet is closed

### Session Pagination (T-05)
- [x] Add `?limit=N` query parameter support to `GET /api/projects/:projectId/sessions` in `src/api/create-app.ts` (line 126), defaulting to 20
- [x] Update `fetchSessions(projectId)` in `client/src/lib/api.ts` to accept an optional `limit` parameter
- [x] In `ProjectTreeItem` (`client/src/views/DashboardView.tsx`), show a "Show all sessions" button when exactly 20 sessions are returned
- [x] Clicking "Show all sessions" re-fetches with no limit and replaces the cached list in `sessionCache`

---

## Phase 2 — Edge Cases & Polish

### Routing Edge Cases (T-01)
- [x] Create a `NotFoundPage` component for the 404 catch-all route
- [x] Ensure session IDs with URL-special characters are properly encoded/decoded through the router
- [ ] Verify Vite dev proxy (`/api`, `/ws`) still works correctly with the router (`client/vite.config.ts` lines 14–21)
- [x] Replace any remaining `<a>` or `window.location` navigations with router `<Link>` components

### Worktree Edge Cases (T-02)
- [x] Handle missing `.claude/.worktrees/` directory gracefully (return empty array, render `(no worktrees)` placeholder in sidebar)
- [x] Handle empty `.claude/.worktrees/` directory (same — `(no worktrees)` placeholder)
- [x] Ensure worktree scanning respects `FLEET_BASE_PATHS` resolution logic from `src/api/resolve.ts`

> **Assumption:** Worktrees are informational only — clicking a worktree does not navigate to a new view. Sessions are **not** nested under worktrees.

---

## Sidebar Layout Reference

Each project in the sidebar follows this structure. Worktrees appear first under their own section title, followed by sessions under theirs.

```
Projects
├── project-1
│   ├── worktrees          ← section title
│   │   ├── worktree-1
│   │   └── worktree-2
│   └── sessions           ← section title
│       ├── session-99
│       ├── session-98
│       └── session-97
│           ...
└── project-2
    ├── worktrees          ← section title
    │   └── (no worktrees) ← placeholder when empty
    └── sessions
        ├── session-100
        ├── session-99
        └── ...
```

- **"worktrees" and "sessions"** are always-visible section titles within each project, not collapsible tree items.
- When a project has zero worktrees, show a `(no worktrees)` placeholder beneath the title.
- Sessions are listed in reverse chronological order (newest first).
