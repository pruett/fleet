import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { useRecentSessions } from "@/hooks/use-recent-sessions";
import { useGlobalSSE } from "@/hooks/use-global-sse";
import { Header } from "@/components/header";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { SessionSearch } from "@/components/session-search";
import { SearchTrigger } from "@/components/search-trigger";
import { SessionList } from "@/components/session-item";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyContent,
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
        <div className="flex min-h-screen items-center justify-center">
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle>You haven't added any projects yet</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={handleOpenDialog}>
                <Plus className="mr-2 size-4" />
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
      <Header projects={projects} onAddProject={handleOpenDialog} />
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        {/* Search trigger */}
        <SearchTrigger onClick={() => setSearchOpen(true)} onAddProject={handleOpenDialog} />

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <SessionList sessions={recentSessions} label="Recent Sessions" />
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
