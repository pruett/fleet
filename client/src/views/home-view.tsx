import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Plus, Search } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { useRecentSessions } from "@/hooks/use-recent-sessions";
import { useGlobalSSE } from "@/hooks/use-global-sse";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { SessionSearch } from "@/components/session-search";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyContent,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/time";
import { truncate } from "@/lib/utils";

function formatMatcherPath(pattern: string): string {
  // Convert dir-encoded patterns like "-Users-foo-code-bar*" to "/Users/foo/code/bar*"
  const cleaned = pattern.replace(/\*+$/, "");
  const path = cleaned.replace(/^-/, "/").replaceAll("-", "/");
  return pattern.endsWith("*") ? `${path}/*` : path;
}

function HomeViewSkeleton() {
  return (
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
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        {/* Search trigger */}
        <InputGroup
          className="cursor-pointer"
          onClick={() => setSearchOpen(true)}
        >
          <InputGroupAddon>
            <Search className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            readOnly
            placeholder="Search projects and sessions…"
            className="pointer-events-none"
          />
          <InputGroupAddon align="inline-end">
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <span className="text-xs">⌘</span>K
            </kbd>
          </InputGroupAddon>
        </InputGroup>

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">
              Recent Sessions
            </h2>
            <div className="space-y-3">
              {recentSessions.map((session) => (
                <Link
                  key={session.sessionId}
                  to={`/session/${encodeURIComponent(session.sessionId)}`}
                  className="block"
                >
                  <Card className="py-4 transition-colors hover:bg-accent/50">
                    <CardHeader className="px-4 py-0">
                      <CardTitle className="text-sm font-medium">
                        {truncate(session.firstPrompt, 100, session.sessionId)}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {session.projectTitle}
                        {session.lastActiveAt && (
                          <>
                            {" "}
                            &middot; {timeAgo(session.lastActiveAt)}
                          </>
                        )}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {loadingSessions && recentSessions.length === 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">
              Recent Sessions
            </h2>
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          </section>
        )}

        {/* Projects */}
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              Projects
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={handleOpenDialog}
            >
              <Plus className="mr-1 size-3.5" />
              Add Project
            </Button>
          </div>
          <div className="space-y-3">
            {projects.map((project) => (
              <Card key={project.slug} className="py-4">
                <CardHeader className="px-4 py-0">
                  <CardTitle className="text-sm font-medium">
                    {project.title}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {project.sessionCount} session
                    {project.sessionCount !== 1 ? "s" : ""}
                    {project.projectIds[0] && (
                      <>
                        {" "}
                        &middot;{" "}
                        <span className="font-mono">
                          {formatMatcherPath(project.projectIds[0])}
                        </span>
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
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
