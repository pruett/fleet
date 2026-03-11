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
  CommandSeparator,
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

interface FlatSession {
  projectSlug: string;
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

  const sortedSessions = useMemo(() => {
    // Build slug → title map from projects
    const slugToTitle = new Map<string, string>();
    for (const p of projects) {
      slugToTitle.set(p.slug, p.title);
    }

    const seen = new Set<string>();
    const items: FlatSession[] = [];

    // Pull from recent sessions (always populated via dedicated query)
    for (const s of recentSessions) {
      if (seen.has(s.sessionId)) continue;
      seen.add(s.sessionId);
      items.push({ projectSlug: s.projectSlug, projectTitle: s.projectTitle, session: s });
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
        items.push({ projectSlug: slug, projectTitle: title, session });
      }
    }

    // Sort by recency (newest first)
    items.sort((a, b) => {
      const aTime = a.session.lastActiveAt ? new Date(a.session.lastActiveAt).getTime() : 0;
      const bTime = b.session.lastActiveAt ? new Date(b.session.lastActiveAt).getTime() : 0;
      return bTime - aTime;
    });

    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryClient is stable; open triggers re-read of cache
  }, [projects, recentSessions, open]);

  const handleSelect = (projectSlug: string, sessionId: string) => {
    onOpenChange(false);
    navigate(`/projects/${encodeURIComponent(projectSlug)}/sessions/${encodeURIComponent(sessionId)}`);
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
                  navigate(`/projects/${p.slug}`);
                }}
                className="!py-0.5"
              >
                <Folder className="mr-2 size-3 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs">{p.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {p.sessionCount}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {projects.length > 0 && sortedSessions.length > 0 && (
          <CommandSeparator />
        )}
        {sortedSessions.length > 0 && (
          <CommandGroup heading="Recent Sessions">
            {sortedSessions.map(({ projectSlug, projectTitle, session: s }) => (
              <CommandItem
                key={s.sessionId}
                value={[s.firstPrompt ?? "", s.sessionId, projectTitle].join(
                  " ",
                )}
                onSelect={() => handleSelect(projectSlug, s.sessionId)}
              >
                <span className="flex flex-col gap-0.5 overflow-hidden">
                  <span className="truncate text-sm">
                    {truncate(s.firstPrompt, 80, "Untitled session")}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate font-mono">{s.sessionId}</span>
                    <span>&middot;</span>
                    <span className="shrink-0">{projectTitle}</span>
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
        )}
      </CommandList>
    </CommandDialog>
  );
}
