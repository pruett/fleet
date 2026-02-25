# PRD

> Source: `ISSUES.md`
> Generated: 2026-02-25
> Total tasks: 6 (1 simple, 3 medium, 2 complex)

---

## Routing

### T-01: Implement client-side routing with proper 404 handling `complex`

**Description:** The app currently has no routing library. `App.tsx` hard-redirects every path to `/`, and `DashboardView.tsx` manually parses `/session/:id` from `window.location.pathname` using regex + `history.pushState`. This needs to be replaced with a proper client-side router so routes are declarative, enforceable, and extensible.

**Affected areas:**
- `client/package.json` — add router dependency
- `client/src/App.tsx` — replace the `window.location` redirect with router provider and route definitions
- `client/src/views/DashboardView.tsx` — remove manual `parseEmbeddedSessionId()` (line 43), `popstate` listener (line 206), and `history.pushState` calls (line 218); use router primitives for navigation and param extraction
- `client/src/views/` — potentially extract route-level components if needed

**Requirements:**
- Install a client-side router (react-router or TanStack Router)
- Define three route outcomes:
  - `/` — renders the sidebar with pinned projects (current `DashboardView` without a selected session)
  - `/session/:sessionId` — renders the sidebar AND the session transcript panel
  - Any other path — renders a 404 page
- Replace all `window.location` and `history.pushState` navigation with router-native navigation (Link components, `useNavigate`, `useParams`, etc.)
- Browser back/forward must work correctly
- The server-side SPA catch-all in `src/api/create-app.ts` requires no changes (already serves `index.html` for all non-API, non-file paths)

**Edge cases:**
- Deep-linking to `/session/:sessionId` on first load must work (server already serves `index.html` for this path)
- Session IDs may contain URL-special characters — ensure proper encoding/decoding
- The Vite dev proxy config (`client/vite.config.ts`) should not need changes, but verify `/api` and `/ws` proxying still works

**Acceptance criteria:**
- [ ] Given a user visits `/`, when the page loads, then the sidebar with pinned projects is displayed and no session panel is shown
- [ ] Given a user visits `/session/abc-123`, when the page loads, then the sidebar is displayed with the `abc-123` session transcript panel open
- [ ] Given a user visits `/foo/bar` or any undefined route, when the page loads, then a 404 page is displayed
- [ ] Given a user clicks a session in the sidebar, when the navigation completes, then the URL updates to `/session/:sessionId` without a full page reload
- [ ] Given a user presses browser back after navigating to a session, when the navigation completes, then they return to the previous route

---

## Features

### T-02: Display active git worktrees per project `complex`

**Description:** Users need visibility into active git worktrees for each project. Claude Code stores worktree checkouts under `<project-dir>/.claude/.worktrees/`. The app should scan these directories and display them in the sidebar beneath each project, giving users a clear picture of parallel work streams.

Currently there is zero worktree support in the codebase. The scanner (`src/scanner/scan-projects.ts`) only reads top-level `.jsonl` session files. The sidebar (`client/src/views/DashboardView.tsx`) shows projects with nested sessions but has no concept of worktrees.

**Affected areas:**
- `src/scanner/` — new scanning logic to read `.claude/.worktrees/` within each project directory
- `src/scanner/types.ts` — new `WorktreeSummary` type (or extend `ProjectSummary` with a worktrees field)
- `src/api/create-app.ts` — new API endpoint or extend existing `/api/projects/:projectId/sessions` response
- `client/src/lib/api.ts` — client-side fetch wrapper for worktree data
- `client/src/views/DashboardView.tsx` — sidebar UI to display worktrees under each project

**Requirements:**
- Scan each project directory's `.claude/.worktrees/` for subdirectories representing active worktrees
- Expose worktree data via the API (either a new endpoint like `/api/projects/:projectId/worktrees` or as part of the project/session response)
- Display worktrees in the sidebar under each project — each worktree should show its directory name and path
- Worktrees should be visually distinct from sessions in the sidebar hierarchy

**Edge cases:**
- A project may have no `.claude/.worktrees/` directory — handle gracefully (show nothing)
- A `.claude/.worktrees/` directory may exist but be empty — treat as no worktrees
- Worktree directories may contain their own sessions — decide whether to show these separately or nest them
- The base paths configuration (`FLEET_BASE_PATHS`) affects where projects are found — worktree scanning must respect the same resolution logic

**Acceptance criteria:**
- [ ] Given a project has active worktrees in `.claude/.worktrees/`, when the user expands that project in the sidebar, then the worktrees are listed
- [ ] Given a project has no `.claude/.worktrees/` directory, when the user expands that project, then no worktree section appears
- [ ] Given a worktree directory exists, when it is displayed, then the worktree name and path are shown
- [ ] Given the API is queried for worktrees, when the project exists, then a list of worktree summaries is returned

**Open questions:**
- [ ] Should worktrees display their own sessions nested underneath, or just appear as directory references?
- [ ] Should clicking a worktree navigate somewhere, or is it informational only?

---

## UI/UX

### T-03: Remove the Stop/Resume action bar from the session panel `simple`

**Description:** The action bar with Stop, Resume, and New Session buttons above the transcript needs to be removed entirely. This is the `<div>` at lines 227-255 of `SessionPanel.tsx` containing three `<Button>` components.

**Affected files:**
- `client/src/views/SessionPanel.tsx` — delete lines 227-255 (the action buttons bar and its containing `<div>`)

**Done when:** The border-separated bar with Stop, Resume, and New Session buttons no longer renders above the transcript.

---

### T-04: Move transcript analytics into a right-side Sheet `medium`

**Description:** The analytics panel is currently rendered inline as a 360px right column within the session view grid layout (`SessionPanel.tsx` line 261). It defaults to open (`analyticsOpen` initialized to `true` in `use-session-data.ts` line 130), taking up permanent horizontal space. It should instead be hidden by default and displayed in a shadcn/ui `Sheet` that slides in from the right.

The `Sheet` component is already installed at `client/src/components/ui/sheet.tsx` and supports a `side="right"` prop.

**Affected files:**
- `client/src/views/SessionPanel.tsx` — replace the inline grid column with a `Sheet` component wrapping `AnalyticsPanel`; change the toggle button to be a `SheetTrigger`
- `client/src/hooks/use-session-data.ts` — change `analyticsOpen` default from `true` to `false`

**Requirements:**
- Default state: analytics hidden (Sheet closed)
- Toggle button in the session header opens/closes the Sheet from the right side
- The `AnalyticsPanel` component itself does not need changes — just its container
- The session transcript should use the full available width when analytics are closed

**Acceptance criteria:**
- [ ] Analytics panel is not visible when a session is first opened
- [ ] Clicking the analytics toggle button opens a Sheet from the right containing the analytics panel
- [ ] Clicking the Sheet close button or overlay dismisses the analytics
- [ ] The transcript area uses full width when analytics are closed

---

### T-05: Limit session list to 20 most recent with "load all" option `medium`

**Description:** When a project is expanded in the sidebar, all sessions are fetched and displayed. For projects with many sessions this clutters the UI and slows loading. The API should return only the 20 most recent sessions by default, with a client-side option to fetch all.

Sessions are scanned in `src/scanner/scan-sessions.ts` (already sorted by `lastActiveAt` descending) and served from `/api/projects/:projectId/sessions` in `src/api/create-app.ts` (line 126). The client fetches via `fetchSessions()` in `client/src/lib/api.ts`.

**Affected files:**
- `src/api/create-app.ts` — add `?limit=N` query parameter support to the sessions endpoint (default 20)
- `client/src/lib/api.ts` — update `fetchSessions()` to accept an optional limit parameter
- `client/src/views/DashboardView.tsx` — add a "Show all sessions" button when the returned list is exactly 20 (indicating more may exist); clicking it re-fetches without the limit

**Requirements:**
- The `/api/projects/:projectId/sessions` endpoint accepts an optional `limit` query parameter (default: 20)
- When `limit` is provided, return at most that many sessions (already sorted by most recent)
- The client defaults to fetching 20 sessions per project
- When a project's session list is exactly 20, show a "Show all sessions" button at the bottom of the list
- Clicking "Show all sessions" re-fetches with no limit and replaces the cached list

**Acceptance criteria:**
- [ ] Expanding a project in the sidebar loads at most 20 sessions
- [ ] A "Show all sessions" button appears when the initial fetch returns exactly 20 sessions
- [ ] Clicking "Show all sessions" fetches and displays all sessions for that project
- [ ] Projects with fewer than 20 sessions do not show the "Show all sessions" button
