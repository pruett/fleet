import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/header";
import { SearchTrigger } from "@/components/search-trigger";
import { SessionSearch } from "@/components/session-search";
import { SessionList } from "@/components/session-item";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { useProjects } from "@/hooks/use-projects";
import { useGlobalSSE } from "@/hooks/use-global-sse";
import { fetchSessions } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/skeleton";

function formatMatcherPath(pattern: string): string {
  const cleaned = pattern.replace(/\*+$/, "");
  const path = cleaned.replace(/^-/, "/").replaceAll("-", "/");
  return pattern.endsWith("*") ? `${path}/*` : path;
}

export function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const {
    projects,
    projectSlugs,
    allDirectories,
    loading: loadingProjects,
    loadingDirectories,
    addProject,
    refreshDirectories,
  } = useProjects();
  const [searchOpen, setSearchOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
    refreshDirectories();
  }, [refreshDirectories]);

  useGlobalSSE();

  const project = useMemo(
    () => projects.find((p) => p.slug === projectId),
    [projects, projectId],
  );

  const { data: sessions, isLoading: loadingSessions } = useQuery({
    queryKey: queryKeys.sessions(projectId ?? ""),
    queryFn: () => fetchSessions(projectId ?? ""),
    enabled: !!projectId,
  });

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

  if (loadingProjects) {
    return (
      <div>
        <Header />
        <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-5 w-48" />
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen">
        <Header projects={projects} selectedSlug={projectId} onAddProject={handleOpenDialog} />

        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <SearchTrigger
            placeholder="Search Sessions (#K)"
            onClick={() => setSearchOpen(true)}
          />

          {project?.projectIds[0] && (
            <p className="mt-2 text-xs text-muted-foreground">
              Matching directories:{" "}
              <span className="font-mono">
                {formatMatcherPath(project.projectIds[0])}
              </span>
            </p>
          )}

          {loadingSessions && (
            <section className="mt-12">
              <div className="mb-6 flex items-center gap-3">
                <Skeleton className="h-3 w-20" />
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

          {sessions && sessions.length > 0 && (
            <SessionList
              sessions={sessions.map((s) => ({ ...s, projectSlug: projectId }))}
              label="Sessions"
            />
          )}

          {sessions && sessions.length === 0 && (
            <p className="mt-10 text-sm text-muted-foreground">
              No sessions yet for this project.
            </p>
          )}
        </div>
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
