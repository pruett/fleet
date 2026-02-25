# Routing
- End goal: Implement sane routing within this application.
- Current context: Currently we are serving a SPA by serving an .html file regardless of the route. We need to have a bit of structure here and implement a few routes - namely:
  - root (/) - serves the main sidebar with projects
  - /session/<session-id> - serves the sidebar layout AND the session transcript within the sidebar content
  - Note: These routes are all implemented but not enforced, visiting any other route should 404
- Recommendation - use something like react-router or tanstack router


# Worktrees
- End goal: User sees a list of active git worktree directories for any given project.
Native support for worktrees is critical in this application. We want to showcase any and all active worktrees by scanning a project directory's `.claude/.worktrees` directory to scan for worktrees.


# Various UI improvements
- Remove the entire top bar above the transcript that has the Stop and Resume buttons. Remove that top bar completely
- The transcript anaalytics should be hidden by default and shown within a shadcn/ui Sheet (docs: https://ui.shadcn.com/docs/components/base/sheet) that opens from the right
- Currently we are loading all project sessions which clutters the UI and is not really needed. We really only need the 20 most recent. Only load the 20 most recent sessions from a given project and provide a button to fetch them all.
