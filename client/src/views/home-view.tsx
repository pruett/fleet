import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { useRecentSessions } from "@/hooks/use-recent-sessions";
import { useGlobalSSE } from "@/hooks/use-global-sse";
import { Header } from "@/components/header";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { SessionSearch } from "@/components/session-search";
import {
  SessionList,
  SessionListHeader,
  SessionItem,
  SessionItemIcon,
  SessionItemContent,
  SessionItemHeader,
  SessionItemTitle,
  SessionItemId,
  SessionItemPrompt,
  SessionItemActions,
  SessionItemTime,
  SessionItemChevron,
} from "@/components/session";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

function HomeViewSkeleton() {
  return (
    <div>
      <Header />
    <div className="mx-auto w-full max-w-3xl space-y-10 px-6 py-12">
      <Skeleton className="h-9 w-full rounded-md" />
      <div className="space-y-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
    </div>
  );
}

export function HomeView() {
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

  const { sessions: recentSessions, loading: loadingSessions } =
    useRecentSessions(10);

  useGlobalSSE();

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

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
    refreshDirectories();
  }, [refreshDirectories]);

  if (loading) {
    return <HomeViewSkeleton />;
  }

  if (projects.length === 0) {
    return (
      <>
        <Header />
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Empty className="max-w-sm border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen className="size-4" />
              </EmptyMedia>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>
                Add a project to start tracking your sessions.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={handleOpenDialog}>
                <Plus data-icon="inline-start" />
                Add Project
              </Button>
            </EmptyContent>
          </Empty>
        </div>

        <AddProjectDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          directories={allDirectories}
          loading={loadingDirectories}
          existingSlugs={projectSlugs}
          onAddProject={addProject}
        />
      </>
    );
  }

  return (
    <>
      <Header projects={projects} onAddProject={handleOpenDialog} onRemoveProject={removeProject} onSearch={() => setSearchOpen(true)} />
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <SessionList>
            <SessionListHeader>Recent Sessions</SessionListHeader>
            {recentSessions.map((session, i) => (
              <SessionItem
                key={session.sessionId}
                session={session}
                isLast={i === recentSessions.length - 1}
              >
                <SessionItemIcon />
                <SessionItemContent>
                  <SessionItemHeader>
                    <SessionItemTitle />
                    <SessionItemId />
                  </SessionItemHeader>
                  <SessionItemPrompt />
                </SessionItemContent>
                <SessionItemActions>
                  <SessionItemTime />
                  <SessionItemChevron />
                </SessionItemActions>
              </SessionItem>
            ))}
          </SessionList>
        )}

        {loadingSessions && recentSessions.length === 0 && (
          <section className="mt-12">
            <div className="mb-6 flex items-center gap-3">
              <Skeleton className="h-3 w-28" />
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="divide-y divide-border/60">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2.5 py-5">
                  <Skeleton className="h-2.5 w-24" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          </section>
        )}

      </div>

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
    </>
  );
}
