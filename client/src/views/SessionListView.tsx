import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSessions } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import type { SessionSummary } from "@/types/api";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface SessionListViewProps {
  projectId: string;
  onSelectSession: (sessionId: string) => void;
  onBack: () => void;
}

function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "…";
}

export function SessionListView({
  projectId,
  onSelectSession,
  onBack,
}: SessionListViewProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSessions(projectId)
      .then((data) => {
        if (!cancelled) {
          setSessions(data);
          setSelectedIndex(0);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load sessions",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, retryCount]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (sessions.length > 0) {
        if (e.key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, sessions.length - 1));
          return;
        }
        if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          onSelectSession(sessions[selectedIndex].sessionId);
          return;
        }
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        onBack();
      }
    },
    [sessions, selectedIndex, onSelectSession, onBack],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Scroll selected card into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const cards = container.querySelectorAll("[data-session-card]");
    cards[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground">Loading sessions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Failed to load sessions</AlertTitle>
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

  const projectName =
    projectId.split("/").filter(Boolean).pop() ?? projectId;

  const breadcrumb = (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              onBack();
            }}
          >
            Projects
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{projectName}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );

  if (sessions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        {breadcrumb}
        <h1 className="mb-6 text-2xl font-bold">Sessions</h1>
        <div className="text-center py-12">
          <p className="text-muted-foreground">No sessions found</p>
          <p className="mt-2 text-sm text-muted-foreground/70">
            Sessions appear here when Claude Code transcripts are detected for
            this project
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      {breadcrumb}
      <h1 className="mb-6 text-2xl font-bold">Sessions</h1>
      <p className="mb-4 text-xs text-muted-foreground">
        Navigate with <kbd className="rounded border border-border bg-muted px-1">j</kbd>/<kbd className="rounded border border-border bg-muted px-1">k</kbd>, select with <kbd className="rounded border border-border bg-muted px-1">Enter</kbd>, back with <kbd className="rounded border border-border bg-muted px-1">Backspace</kbd>
      </p>
      <div ref={listRef} className="flex flex-col gap-3">
        {sessions.map((session, index) => (
          <Card
            key={session.sessionId}
            data-session-card
            className={`cursor-pointer transition-colors hover:bg-accent/50 ${
              index === selectedIndex ? "ring-2 ring-ring" : ""
            }`}
            onClick={() => onSelectSession(session.sessionId)}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-sm">
                    {session.firstPrompt
                      ? truncate(session.firstPrompt, 100)
                      : "No prompt"}
                  </CardTitle>
                  <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {session.model && <span>{session.model}</span>}
                    <span>{formatCost(session.cost)}</span>
                    <span>
                      {formatTokens(session.inputTokens + session.outputTokens)}{" "}
                      tokens
                    </span>
                    {session.gitBranch && (
                      <span className="font-mono text-xs">
                        {session.gitBranch}
                      </span>
                    )}
                  </CardDescription>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground/70">
                    {session.startedAt && (
                      <span>Started {timeAgo(session.startedAt)}</span>
                    )}
                    {session.lastActiveAt && (
                      <span>Active {timeAgo(session.lastActiveAt)}</span>
                    )}
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {formatCost(session.cost)}
                </Badge>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
