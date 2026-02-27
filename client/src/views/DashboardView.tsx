import { useCallback, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Folder,
  ChevronRight,
  GitBranch,
  Plus,
  X,
  ChevronsDown,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { fetchSessions, fetchWorktrees } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import type { GroupedProject } from "@/types/api";
import { useProjects } from "@/hooks/use-projects";
import { useSessionActivity } from "@/hooks/use-session-activity";
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
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onRemove: (slug: string) => void;
}

const SESSION_PAGE_SIZE = 10;

function ProjectTreeItem({
  project,
  selectedSessionId,
  onSelectSession: _onSelectSession,
  onRemove,
}: ProjectTreeItemProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sessionFilter, setSessionFilter] = useState("");
  const limit = showAll ? undefined : SESSION_PAGE_SIZE;

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions(project.slug, limit),
    queryFn: () => fetchSessions(project.slug, limit),
    enabled: open,
  });

  const worktreesQuery = useQuery({
    queryKey: queryKeys.worktrees(project.slug),
    queryFn: () => fetchWorktrees(project.slug),
    enabled: open,
  });

  const loading = sessionsQuery.isLoading || worktreesQuery.isLoading;
  const isRefreshing =
    (sessionsQuery.isFetching && !sessionsQuery.isLoading) ||
    (worktreesQuery.isFetching && !worktreesQuery.isLoading);

  const sessions = sessionsQuery.data;
  const worktrees = worktreesQuery.data;
  const truncated = !showAll && sessions?.length === SESSION_PAGE_SIZE;

  const filteredSessions = useMemo(() => {
    if (!sessions || !sessionFilter.trim()) return sessions;
    const q = sessionFilter.toLowerCase();
    return sessions.filter(
      (s) =>
        s.sessionId.toLowerCase().includes(q) ||
        s.firstPrompt?.toLowerCase().includes(q),
    );
  }, [sessions, sessionFilter]);

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.sessionsPrefix(project.slug),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.worktrees(project.slug),
        }),
      ]);
    } catch {
      toast.error("Failed to refresh project data");
    }
  };

  const handleShowAll = () => setShowAll(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
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
          className="right-6"
          onClick={handleRefresh}
        >
          <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
          <span className="sr-only">Refresh project</span>
        </SidebarMenuAction>

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
            {!loading && worktrees !== undefined && (
              <>
                <SidebarMenuSubItem>
                  <span className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    worktrees
                  </span>
                </SidebarMenuSubItem>
                {worktrees.length === 0 ? (
                  <SidebarMenuSubItem>
                    <span className="px-2 py-1 text-xs italic text-muted-foreground">
                      (no worktrees)
                    </span>
                  </SidebarMenuSubItem>
                ) : (
                  worktrees.map((wt) => (
                    <SidebarMenuSubItem key={wt.name}>
                      <SidebarMenuSubButton asChild={false}>
                        <GitBranch className="size-3.5 shrink-0" />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex flex-col gap-0 truncate">
                              <span className="truncate text-xs">{wt.name}</span>
                              {wt.branch && (
                                <span className="truncate text-[10px] text-muted-foreground">
                                  {wt.branch}
                                </span>
                              )}
                            </span>
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
            {!loading && sessions !== undefined && (
              <>
                <SidebarMenuSubItem>
                  <span className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    sessions
                  </span>
                </SidebarMenuSubItem>
                {sessions.length > 0 && (
                  <SidebarMenuSubItem>
                    <div className="relative px-2 py-1">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Filter by ID or prompt…"
                        value={sessionFilter}
                        onChange={(e) => setSessionFilter(e.target.value)}
                        className="h-6 w-full rounded border border-sidebar-border bg-transparent pl-5 pr-2 text-[11px] text-sidebar-foreground placeholder:text-muted-foreground/60 outline-none focus:border-sidebar-ring"
                      />
                    </div>
                  </SidebarMenuSubItem>
                )}
                {filteredSessions?.length === 0 ? (
                  <SidebarMenuSubItem>
                    <span className="px-2 py-1 text-xs text-muted-foreground">
                      {sessionFilter.trim() ? "No matching sessions" : "No sessions"}
                    </span>
                  </SidebarMenuSubItem>
                ) : (
                  <>
                    {filteredSessions?.map((session) => (
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
                              <span className="truncate text-[10px] font-mono text-muted-foreground/70">
                                {session.sessionId}
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
                    ))}
                    {truncated && !sessionFilter.trim() && (
                      <SidebarMenuSubItem>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          onClick={handleShowAll}
                          disabled={showAll && sessionsQuery.isFetching}
                        >
                          <ChevronsDown className="size-3" />
                          {showAll && sessionsQuery.isFetching
                            ? "Loading\u2026"
                            : "Show all sessions"}
                        </button>
                      </SidebarMenuSubItem>
                    )}
                  </>
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
  useSessionActivity();

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

  const selectSession = useCallback(
    (sessionId: string) => {
      navigate(`/session/${encodeURIComponent(sessionId)}`);
    },
    [navigate],
  );

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
    refreshDirectories();
  }, [refreshDirectories]);

  return (
    <SidebarProvider>
      <Sidebar side="left">
        <SidebarContent className="bg-muted/30">
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
