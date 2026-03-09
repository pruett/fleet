import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Folder } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { timeAgo } from "@/lib/time";
import { truncate } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { useRecentSessions } from "@/hooks/use-recent-sessions";
import type { SessionSummary, GroupedProject } from "@fleet/shared";

interface SessionSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: GroupedProject[];
}

interface GroupedSession {
  projectTitle: string;
  session: SessionSummary;
}

export function SessionSearch({
  open,
  onOpenChange,
  projects,
}: SessionSearchProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { sessions: recentSessions } = useRecentSessions(25);

  const grouped = useMemo(() => {
    // Build slug → title map from projects
    const slugToTitle = new Map<string, string>();
    for (const p of projects) {
      slugToTitle.set(p.slug, p.title);
    }

    const seen = new Set<string>();
    const items: GroupedSession[] = [];

    // Pull from recent sessions (always populated via dedicated query)
    for (const s of recentSessions) {
      if (seen.has(s.sessionId)) continue;
      seen.add(s.sessionId);
      items.push({ projectTitle: s.projectTitle, session: s });
    }

    // Also pull from per-project session cache (populated on dashboard view)
    const cached = queryClient.getQueriesData<SessionSummary[]>({
      queryKey: queryKeys.sessionsAll(),
    });

    for (const [key, data] of cached) {
      if (!data || !Array.isArray(data)) continue;
      const slug = key[1] as string;
      const title = slugToTitle.get(slug) ?? slug;

      for (const session of data) {
        if (seen.has(session.sessionId)) continue;
        seen.add(session.sessionId);
        items.push({ projectTitle: title, session });
      }
    }

    // Group by project title
    const groups = new Map<string, SessionSummary[]>();
    for (const item of items) {
      const list = groups.get(item.projectTitle) ?? [];
      list.push(item.session);
      groups.set(item.projectTitle, list);
    }

    return groups;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryClient is stable; open triggers re-read of cache
  }, [projects, recentSessions, open]);

  const handleSelect = (sessionId: string) => {
    onOpenChange(false);
    navigate(`/session/${encodeURIComponent(sessionId)}`);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search Sessions"
      description="Fuzzy search across all cached sessions"
      showCloseButton={false}
    >
      <CommandInput placeholder="Search sessions by prompt, ID, model, branch…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.map((p) => (
              <CommandItem
                key={p.slug}
                value={`project ${p.title} ${p.projectIds.join(" ")}`}
                onSelect={() => {
                  onOpenChange(false);
                }}
              >
                <Folder className="mr-2 size-4 shrink-0 text-muted-foreground" />
                <span className="flex flex-col gap-0.5 overflow-hidden">
                  <span className="truncate text-sm">{p.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.sessionCount} session{p.sessionCount !== 1 ? "s" : ""}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {[...grouped.entries()].map(([title, sessions]) => (
          <CommandGroup key={title} heading={title}>
            {sessions.map((s) => (
              <CommandItem
                key={s.sessionId}
                value={[
                  s.firstPrompt ?? "",
                  s.sessionId,
                  s.model ?? "",
                  s.gitBranch ?? "",
                ].join(" ")}
                onSelect={() => handleSelect(s.sessionId)}
              >
                <span className="flex flex-col gap-0.5 overflow-hidden">
                  <span className="truncate text-sm">
                    {truncate(s.firstPrompt, 80, "Untitled session")}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate font-mono">{s.sessionId}</span>
                    {s.lastActiveAt && (
                      <>
                        <span>&middot;</span>
                        <span className="shrink-0">
                          {timeAgo(s.lastActiveAt)}
                        </span>
                      </>
                    )}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
