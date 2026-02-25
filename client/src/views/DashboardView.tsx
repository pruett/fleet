import { useCallback, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { Folder, ChevronRight, GitBranch, Plus, X } from "lucide-react";
import { fetchSessions, fetchWorktrees } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import type { GroupedProject, SessionSummary, WorktreeSummary } from "@/types/api";
import { useProjects } from "@/hooks/use-projects";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { SessionPanel } from "@/views/SessionPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionLabel(firstPrompt: string | null): string {
  if (!firstPrompt) return "Untitled session";
  return firstPrompt.length > 60
    ? firstPrompt.slice(0, 60) + "\u2026"
    : firstPrompt;
}

// ---------------------------------------------------------------------------
// ProjectTreeItem — a single collapsible project with lazy-loaded sessions
// ---------------------------------------------------------------------------

interface ProjectTreeItemProps {
  project: GroupedProject;
  sessionCache: Map<string, SessionSummary[]>;
  worktreeCache: Map<string, WorktreeSummary[]>;
  onSessionsLoaded: (slug: string, sessions: SessionSummary[]) => void;
  onWorktreesLoaded: (slug: string, worktrees: WorktreeSummary[]) => void;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onRemove: (slug: string) => void;
}

function ProjectTreeItem({
  project,
  sessionCache,
  worktreeCache,
  onSessionsLoaded,
  onWorktreesLoaded,
  selectedSessionId,
  onSelectSession,
  onRemove,
}: ProjectTreeItemProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const cachedSessions = sessionCache.get(project.slug);
  const cachedWorktrees = worktreeCache.get(project.slug);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen && !cachedSessions && !loading) {
        setLoading(true);
        Promise.all([
          fetchSessions(project.slug)
            .then((sessions) => onSessionsLoaded(project.slug, sessions))
            .catch(() => {}),
          fetchWorktrees(project.slug)
            .then((worktrees) => onWorktreesLoaded(project.slug, worktrees))
            .catch(() => {}),
        ]).finally(() => setLoading(false));
      }
    },
    [cachedSessions, loading, project.slug, onSessionsLoaded, onWorktreesLoaded],
  );

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton>
            <ChevronRight
              className={`transition-transform ${open ? "rotate-90" : ""}`}
            />
            <Folder />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="truncate">{project.title}</span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {project.matchedDirIds.length} dir
                {project.matchedDirIds.length !== 1 ? "s" : ""}
              </TooltipContent>
            </Tooltip>
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <SidebarMenuAction
          showOnHover
          onClick={(e) => {
            e.stopPropagation();
            onRemove(project.slug);
          }}
        >
          <X />
          <span className="sr-only">Remove project</span>
        </SidebarMenuAction>

        <CollapsibleContent>
          <SidebarMenuSub>
            {loading && (
              <>
                <SidebarMenuSkeleton />
                <SidebarMenuSkeleton />
                <SidebarMenuSkeleton />
              </>
            )}

            {/* Worktrees section */}
            {!loading && cachedWorktrees !== undefined && (
              <>
                <SidebarMenuSubItem>
                  <span className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    worktrees
                  </span>
                </SidebarMenuSubItem>
                {cachedWorktrees.length === 0 ? (
                  <SidebarMenuSubItem>
                    <span className="px-2 py-1 text-xs italic text-muted-foreground">
                      (no worktrees)
                    </span>
                  </SidebarMenuSubItem>
                ) : (
                  cachedWorktrees.map((wt) => (
                    <SidebarMenuSubItem key={wt.name}>
                      <SidebarMenuSubButton asChild={false}>
                        <GitBranch className="size-3.5 shrink-0" />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate text-xs">{wt.name}</span>
                          </TooltipTrigger>
                          <TooltipContent side="right">{wt.path}</TooltipContent>
                        </Tooltip>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))
                )}
              </>
            )}

            {/* Sessions section */}
            {!loading && cachedSessions !== undefined && (
              <>
                <SidebarMenuSubItem>
                  <span className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    sessions
                  </span>
                </SidebarMenuSubItem>
                {cachedSessions.length === 0 ? (
                  <SidebarMenuSubItem>
                    <span className="px-2 py-1 text-xs text-muted-foreground">
                      No sessions
                    </span>
                  </SidebarMenuSubItem>
                ) : (
                  cachedSessions.map((session) => (
                    <SidebarMenuSubItem key={session.sessionId}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={session.sessionId === selectedSessionId}
                      >
                        <Link
                          to={`/session/${encodeURIComponent(session.sessionId)}`}
                        >
                          <span className="flex flex-col gap-0.5">
                            <span className="truncate text-xs">
                              {sessionLabel(session.firstPrompt)}
                            </span>
                            {session.lastActiveAt && (
                              <span className="text-[10px] text-muted-foreground">
                                {timeAgo(session.lastActiveAt)}
                              </span>
                            )}
                          </span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))
                )}
              </>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// DashboardView — sidebar shell with project/session tree
// ---------------------------------------------------------------------------

export function DashboardView() {
  const {
    projects,
    projectSlugs,
    allDirectories,
    loading,
    loadingDirectories,
    addProject,
    removeProject,
    refreshDirectories,
  } = useProjects();

  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const selectedSessionId = routeSessionId ?? null;
  const navigate = useNavigate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [sessionCache, setSessionCache] = useState<
    Map<string, SessionSummary[]>
  >(new Map());
  const [worktreeCache, setWorktreeCache] = useState<
    Map<string, WorktreeSummary[]>
  >(new Map());

  const selectSession = useCallback(
    (sessionId: string) => {
      navigate(`/session/${encodeURIComponent(sessionId)}`);
    },
    [navigate],
  );

  const handleSessionsLoaded = useCallback(
    (slug: string, sessions: SessionSummary[]) => {
      setSessionCache((prev) => {
        const next = new Map(prev);
        next.set(slug, sessions);
        return next;
      });
    },
    [],
  );

  const handleWorktreesLoaded = useCallback(
    (projectId: string, worktrees: WorktreeSummary[]) => {
      setWorktreeCache((prev) => {
        const next = new Map(prev);
        next.set(projectId, worktrees);
        return next;
      });
    },
    [],
  );

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
    refreshDirectories();
  }, [refreshDirectories]);

  return (
    <SidebarProvider>
      <Sidebar side="left">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction title="Add project" onClick={handleOpenDialog}>
              <Plus />
              <span className="sr-only">Add project</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {loading && (
                  <>
                    <SidebarMenuSkeleton showIcon />
                    <SidebarMenuSkeleton showIcon />
                    <SidebarMenuSkeleton showIcon />
                    <SidebarMenuSkeleton showIcon />
                  </>
                )}
                {!loading &&
                  projects.map((project) => (
                    <ProjectTreeItem
                      key={project.slug}
                      project={project}
                      sessionCache={sessionCache}
                      worktreeCache={worktreeCache}
                      onSessionsLoaded={handleSessionsLoaded}
                      onWorktreesLoaded={handleWorktreesLoaded}
                      selectedSessionId={selectedSessionId}
                      onSelectSession={selectSession}
                      onRemove={removeProject}
                    />
                  ))}
                {!loading && projects.length === 0 && (
                  <li className="px-3 py-4 text-center">
                    <p className="mb-2 text-xs text-muted-foreground">
                      No projects
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleOpenDialog}
                    >
                      <Plus className="mr-1 size-3.5" />
                      Add a project
                    </Button>
                  </li>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="overflow-hidden">
        {selectedSessionId ? (
          <SessionPanel
            key={selectedSessionId}
            sessionId={selectedSessionId}
            onGoSession={selectSession}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="text-muted-foreground">
              Select a session from the sidebar
            </p>
          </div>
        )}
      </SidebarInset>

      <AddProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        directories={allDirectories}
        loading={loadingDirectories}
        existingSlugs={projectSlugs}
        onAddProject={addProject}
      />
    </SidebarProvider>
  );
}
