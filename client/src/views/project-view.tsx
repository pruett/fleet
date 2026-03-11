import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Header } from "@/components/header";
import { SessionList } from "@/components/session-item";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { useProjects } from "@/hooks/use-projects";
import { useGlobalSSE } from "@/hooks/use-global-sse";
import { fetchSessions } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/skeleton";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

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
    removeProject,
    refreshDirectories,
  } = useProjects();
  const [searchQuery, setSearchQuery] = useState("");
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

  const filteredSessions = useMemo(() => {
    if (!sessions || !searchQuery.trim()) return sessions;
    const query = searchQuery.toLowerCase();

    const fuzzyMatch = (field: string) => {
      const lower = field.toLowerCase();
      let qi = 0;
      for (let i = 0; i < lower.length && qi < query.length; i++) {
        if (lower[i] === query[qi]) qi++;
      }
      return qi === query.length;
    };

    return sessions.filter((s) => {
      // Exact substring match on session ID (highest priority)
      if (s.sessionId.toLowerCase().includes(query)) return true;
      // Fuzzy match on other fields
      const fuzzyFields = [s.firstPrompt, s.gitBranch, s.model, s.cwd].filter(
        Boolean,
      ) as string[];
      return fuzzyFields.some(fuzzyMatch);
    });
  }, [sessions, searchQuery]);

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
        <Header projects={projects} selectedSlug={projectId} onAddProject={handleOpenDialog} onRemoveProject={removeProject} />

        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <InputGroup>
            <InputGroupAddon>
              <Search className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search sessions…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </InputGroup>

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

          {filteredSessions && filteredSessions.length > 0 && (
            <SessionList
              sessions={filteredSessions.map((s) => ({ ...s, projectSlug: projectId }))}
              label={searchQuery.trim() ? "Results" : "Sessions"}
            />
          )}

          {filteredSessions && filteredSessions.length === 0 && (
            <p className="mt-10 text-sm text-muted-foreground">
              {searchQuery.trim()
                ? "No sessions match your search."
                : "No sessions yet for this project."}
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
    </>
  );
}
