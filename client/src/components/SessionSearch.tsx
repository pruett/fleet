import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
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

  const grouped = useMemo(() => {
    // Build slug → title map from projects
    const slugToTitle = new Map<string, string>();
    for (const p of projects) {
      slugToTitle.set(p.slug, p.title);
    }

    // Read all cached session queries (keys starting with ["sessions"])
    const cached = queryClient.getQueriesData<SessionSummary[]>({
      queryKey: queryKeys.sessionsAll(),
    });

    // Deduplicate sessions (a project may have both limited and unlimited cache entries)
    const seen = new Set<string>();
    const items: GroupedSession[] = [];

    for (const [key, data] of cached) {
      if (!data || !Array.isArray(data)) continue;
      // key shape: ["sessions", slug] or ["sessions", slug, limit]
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
  }, [projects, open]);

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
        <CommandEmpty>No sessions found.</CommandEmpty>
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
