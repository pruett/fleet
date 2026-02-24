import { useCallback, useEffect, useRef, useState } from "react";
import { fetchProjects } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import type { ProjectSummary } from "@/types/api";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ProjectListViewProps {
  onSelectProject: (projectId: string) => void;
}

function sortByLastActive(projects: ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort((a, b) => {
    if (!a.lastActiveAt && !b.lastActiveAt) return 0;
    if (!a.lastActiveAt) return 1;
    if (!b.lastActiveAt) return -1;
    return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
  });
}

export function ProjectListView({ onSelectProject }: ProjectListViewProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((data) => {
        if (!cancelled) {
          setProjects(sortByLastActive(data));
          setSelectedIndex(0);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load projects");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [retryCount]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (projects.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, projects.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        onSelectProject(projects[selectedIndex].id);
      }
    },
    [projects, selectedIndex, onSelectProject],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Scroll selected card into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const cards = container.querySelectorAll("[data-project-card]");
    cards[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground">Loading projects…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Failed to load projects</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                setLoading(true);
                setError(null);
                setRetryCount((c) => c + 1);
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No projects found</p>
          <p className="mt-2 text-sm text-muted-foreground/70">
            Projects appear here when Claude Code session transcripts are
            detected in <code className="rounded bg-muted px-1.5 py-0.5 text-xs">~/.claude/projects/</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Projects</h1>
      <p className="mb-4 text-xs text-muted-foreground">
        Navigate with <kbd className="rounded border border-border bg-muted px-1">j</kbd>/<kbd className="rounded border border-border bg-muted px-1">k</kbd>, select with <kbd className="rounded border border-border bg-muted px-1">Enter</kbd>
      </p>
      <div ref={listRef} className="flex flex-col gap-3">
        {projects.map((project, index) => (
          <Card
            key={project.id}
            data-project-card
            className={`cursor-pointer transition-colors hover:bg-accent/50 ${
              index === selectedIndex ? "ring-2 ring-ring" : ""
            }`}
            onClick={() => onSelectProject(project.id)}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="truncate font-mono text-sm">
                    {project.path}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {project.sessionCount}{" "}
                    {project.sessionCount === 1 ? "session" : "sessions"}
                    {project.lastActiveAt && (
                      <span> · {timeAgo(project.lastActiveAt)}</span>
                    )}
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {project.sessionCount}
                </Badge>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
