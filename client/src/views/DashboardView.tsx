import { useCallback, useEffect, useState } from "react";
import { Folder, ChevronRight, Plus, X } from "lucide-react";
import { fetchSessions } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import type { ProjectSummary, SessionSummary } from "@/types/api";
import { usePinnedProjects } from "@/hooks/use-pinned-projects";
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
// URL helpers
// ---------------------------------------------------------------------------

/** Extract session ID from `/new/session/:id` pathname, or null. */
function parseEmbeddedSessionId(): string | null {
  const match = window.location.pathname.match(/^\/new\/session\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function projectDisplayName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

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
  project: ProjectSummary;
  sessionCache: Map<string, SessionSummary[]>;
  onSessionsLoaded: (projectId: string, sessions: SessionSummary[]) => void;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onUnpin: (projectId: string) => void;
}

function ProjectTreeItem({
  project,
  sessionCache,
  onSessionsLoaded,
  selectedSessionId,
  onSelectSession,
  onUnpin,
}: ProjectTreeItemProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const cached = sessionCache.get(project.id);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen && !cached && !loading) {
        setLoading(true);
        fetchSessions(project.id)
          .then((sessions) => {
            onSessionsLoaded(project.id, sessions);
          })
          .catch(() => {
            // Silently handle — user can retry by closing/reopening
          })
          .finally(() => setLoading(false));
      }
    },
    [cached, loading, project.id, onSessionsLoaded],
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
                <span className="truncate">{projectDisplayName(project.path)}</span>
              </TooltipTrigger>
              <TooltipContent side="right">{project.path}</TooltipContent>
            </Tooltip>
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <SidebarMenuAction
          showOnHover
          onClick={(e) => {
            e.stopPropagation();
            onUnpin(project.id);
          }}
        >
          <X />
          <span className="sr-only">Unpin project</span>
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
            {cached?.map((session) => (
              <SidebarMenuSubItem key={session.sessionId}>
                <SidebarMenuSubButton
                  asChild
                  isActive={session.sessionId === selectedSessionId}
                >
                  <a
                    href={`/new/session/${encodeURIComponent(session.sessionId)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onSelectSession(session.sessionId);
                    }}
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
                  </a>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
            {cached?.length === 0 && (
              <SidebarMenuSubItem>
                <span className="px-2 py-1 text-xs text-muted-foreground">
                  No sessions
                </span>
              </SidebarMenuSubItem>
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
    pinnedProjects,
    pinnedIds,
    allProjects,
    loading,
    loadingAllProjects,
    pinProject,
    unpinProject,
    refreshAllProjects,
  } = usePinnedProjects();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [sessionCache, setSessionCache] = useState<
    Map<string, SessionSummary[]>
  >(new Map());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    parseEmbeddedSessionId,
  );

  // Sync state with browser back/forward
  useEffect(() => {
    function handlePopState() {
      setSelectedSessionId(parseEmbeddedSessionId());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const selectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    const url = `/new/session/${encodeURIComponent(sessionId)}`;
    history.pushState(null, "", url);
  }, []);

  const handleSessionsLoaded = useCallback(
    (projectId: string, sessions: SessionSummary[]) => {
      setSessionCache((prev) => {
        const next = new Map(prev);
        next.set(projectId, sessions);
        return next;
      });
    },
    [],
  );

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
    refreshAllProjects();
  }, [refreshAllProjects]);

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
                  pinnedProjects.map((project) => (
                    <ProjectTreeItem
                      key={project.id}
                      project={project}
                      sessionCache={sessionCache}
                      onSessionsLoaded={handleSessionsLoaded}
                      selectedSessionId={selectedSessionId}
                      onSelectSession={selectSession}
                      onUnpin={unpinProject}
                    />
                  ))}
                {!loading && pinnedProjects.length === 0 && (
                  <li className="px-3 py-4 text-center">
                    <p className="mb-2 text-xs text-muted-foreground">
                      No pinned projects
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
        projects={allProjects}
        loading={loadingAllProjects}
        pinnedProjectIds={pinnedIds}
        onSelectProject={pinProject}
      />
    </SidebarProvider>
  );
}
