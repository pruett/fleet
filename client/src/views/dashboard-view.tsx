import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Folder,
  ChevronRight,
  Plus,
  X,
  ChevronsDown,
  RefreshCw,
  Search,
  Ship,
} from "lucide-react";
import { fetchSessions } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import type { GroupedProject } from "@fleet/shared";
import { useProjects } from "@/hooks/use-projects";
import { useGlobalSSE } from "@/hooks/use-global-sse";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { SessionSearch } from "@/components/session-search";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
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
  SidebarTrigger,
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
import { SessionPanel } from "@/views/session-panel";

// ---------------------------------------------------------------------------
// ProjectTreeItem — a single collapsible project with lazy-loaded sessions
// ---------------------------------------------------------------------------

interface ProjectTreeItemProps {
  project: GroupedProject;
  selectedSessionId: string | null;
  onRemove: (slug: string) => void;
}

const SESSION_PAGE_SIZE = 15;

function ProjectTreeItem({
  project,
  selectedSessionId,
  onRemove,
}: ProjectTreeItemProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const limit = showAll ? undefined : SESSION_PAGE_SIZE;

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions(project.slug, limit),
    queryFn: () => fetchSessions(project.slug, limit),
    enabled: open,
  });

  const loading = sessionsQuery.isLoading;
  const isRefreshing =
    sessionsQuery.isFetching && !sessionsQuery.isLoading;

  const sessions = sessionsQuery.data;
  const truncated = !showAll && sessions?.length === SESSION_PAGE_SIZE;

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation();
    void queryClient.invalidateQueries({
      queryKey: queryKeys.sessionsPrefix(project.slug),
    });
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

            {/* Sessions section */}
            {!loading && sessions !== undefined && (
              <>
                <SidebarMenuSubItem>
                  <span className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    sessions
                  </span>
                </SidebarMenuSubItem>
                {sessions.length === 0 ? (
                  <SidebarMenuSubItem>
                    <span className="px-2 py-1 text-xs text-muted-foreground">
                      No sessions
                    </span>
                  </SidebarMenuSubItem>
                ) : (
                  <>
                    {sessions.map((session) => (
                      <SidebarMenuSubItem key={session.sessionId}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={session.sessionId === selectedSessionId}
                        >
                          <Link
                            to={`/session/${encodeURIComponent(session.sessionId)}`}
                          >
                            <span className="flex flex-col gap-0.5">
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
                    {truncated && (
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
  const queryClient = useQueryClient();

  // Subscribe to global SSE broadcast events for real-time sidebar updates
  useGlobalSSE();

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.config() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll() });
  }, [queryClient]);

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
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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
    <SidebarProvider className="h-svh !min-h-0 overflow-hidden">
      <Sidebar side="left">
        <SidebarHeader className="px-4 py-3">
          <span className="flex items-center gap-3 text-sm font-light font-mono uppercase tracking-widest">
            <Ship className="h-4 w-4" aria-hidden="true" />
            Fleet
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-6"
              onClick={refreshAll}
              title="Refresh all"
            >
              <RefreshCw className="size-3.5" />
              <span className="sr-only">Refresh all</span>
            </Button>
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="uppercase font-mono">
              Projects
              <span className="ml-auto flex items-center gap-0.5">
                <SidebarGroupAction
                  title="Search sessions (⌘K)"
                  onClick={() => setSearchOpen(true)}
                  className="static"
                >
                  <Search />
                  <span className="sr-only">Search sessions</span>
                </SidebarGroupAction>
                <SidebarGroupAction
                  title="Add project"
                  onClick={handleOpenDialog}
                  className="static"
                >
                  <Plus />
                  <span className="sr-only">Add project</span>
                </SidebarGroupAction>
              </span>
            </SidebarGroupLabel>
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

      <SidebarInset>
        {selectedSessionId ? (
          <SessionPanel
            key={selectedSessionId}
            sessionId={selectedSessionId}
            onSelectSession={selectSession}
          />
        ) : (
          <div className="flex h-full flex-col">
            <header className="flex h-12 shrink-0 items-center border-b bg-background px-4">
              <SidebarTrigger className="-ml-1" />
            </header>
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="text-muted-foreground">
                Select a session from the sidebar
              </p>
            </div>
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

      <SessionSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        projects={projects}
      />
    </SidebarProvider>
  );
}
