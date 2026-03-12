import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Header } from "@/components/header";
import {
  SessionList,
  SessionListHeader,
  SessionItem,
  SessionItemContent,
  SessionItemHeader,
  SessionItemId,
  SessionItemPrompt,
  SessionItemActions,
  SessionItemTime,
  SessionItemChevron,
} from "@/components/session";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/hooks/use-projects";
import { useGlobalSSE } from "@/hooks/use-global-sse";
import { fetchSessions } from "@/lib/api";

import { queryKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
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
  const [showAll, setShowAll] = useState(false);
  const PAGE_SIZE = 20;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          '[data-slot="session-list"] input',
        );
        input?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
    refreshDirectories();
  }, [refreshDirectories]);

  useGlobalSSE();

  const project = useMemo(
    () => projects.find((p) => p.slug === projectId),
    [projects, projectId],
  );

  const limit = showAll ? undefined : PAGE_SIZE;

  const { data: sessions, isLoading: loadingSessions } = useQuery({
    queryKey: queryKeys.sessions(projectId ?? "", limit),
    queryFn: () => fetchSessions(projectId ?? "", limit),
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
          <div className="flex items-center justify-center gap-2">
            {project?.color && (
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
            )}
            <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight text-balance">
              {project?.title ?? projectId}
            </h1>
          </div>

          {project && (
            <div className="mt-3 flex items-center justify-center">
              <Badge variant="secondary">
                {project.sessionCount} {project.sessionCount === 1 ? "session" : "sessions"}
              </Badge>
            </div>
          )}

          {project?.projectIds[0] && (
            <p className="mt-2 text-xs text-muted-foreground text-center">
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
            <SessionList>
              <div className="flex items-center gap-4 border-b pb-2">
                <SessionListHeader className="shrink-0 border-0 pb-0">
                  {searchQuery.trim() ? "Results" : "Sessions"}
                </SessionListHeader>
                <InputGroup className="ml-auto w-48 !rounded-full shadow-none">
                  <InputGroupAddon>
                    <Search className="size-4" />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder="Search sessions…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setSearchQuery("");
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                  {searchQuery && (
                    <InputGroupAddon align="inline-end">
                      <Kbd>esc</Kbd>
                    </InputGroupAddon>
                  )}
                </InputGroup>
              </div>

              {filteredSessions && filteredSessions.length > 0 ? (
                filteredSessions.map((s, i) => (
                  <SessionItem
                    key={s.sessionId}
                    session={{ ...s, projectSlug: projectId, projectColor: project?.color }}
                    isLast={i === filteredSessions.length - 1}
                  >
                    <SessionItemContent>
                      <SessionItemHeader>
                        <SessionItemId />
                      </SessionItemHeader>
                      <SessionItemPrompt />
                    </SessionItemContent>
                    <SessionItemActions>
                      <SessionItemTime />
                      <SessionItemChevron />
                    </SessionItemActions>
                  </SessionItem>
                ))
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No sessions match your search.
                </p>
              )}
            </SessionList>
          )}

          {sessions && sessions.length > 0 && !showAll && !searchQuery.trim() && sessions.length >= PAGE_SIZE && (
            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
                Load older sessions
              </Button>
            </div>
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
    </>
  );
}
