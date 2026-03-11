import { Link } from "react-router";
import { Terminal, GitBranch, ArrowUpRight } from "lucide-react";
import type { SessionSummary } from "@fleet/shared";
import { timeAgo } from "@/lib/time";
import { truncate } from "@/lib/utils";

interface SessionItemProps {
  session: SessionSummary & { projectTitle?: string; projectSlug?: string };
}

export function SessionItem({ session }: SessionItemProps) {
  const slug = session.projectSlug ?? "unknown";
  return (
    <Link
      to={`/projects/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(session.sessionId)}`}
      className="group/item relative block opacity-100 transition-opacity duration-300 ease-out group-hover/list:opacity-40 hover:!opacity-100"
    >
      <article className="relative rounded-lg py-5 px-3 -mx-3 transition-colors duration-300 ease-out group-hover/item:bg-foreground/[0.03]">
        {/* Top row: section label + timestamp */}
        <div className="mb-2 flex items-center gap-2">
          {session.projectTitle && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/60">
              <Terminal className="size-3" strokeWidth={1.5} />
              {session.projectTitle}
            </span>
          )}
          {session.gitBranch && (
            <>
              {session.projectTitle && (
                <span className="text-muted-foreground/30">/</span>
              )}
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground/40">
                <GitBranch className="size-2.5" strokeWidth={1.5} />
                {session.gitBranch}
              </span>
            </>
          )}
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/40">
            {session.lastActiveAt ? timeAgo(session.lastActiveAt) : ""}
          </span>
        </div>

        {/* Headline */}
        <h3 className="text-[15px] font-normal leading-snug tracking-[-0.01em] text-foreground/90 transition-colors duration-200 group-hover/item:text-foreground">
          {truncate(session.firstPrompt, 140, session.sessionId)}
        </h3>

        {/* Hover arrow indicator */}
        <ArrowUpRight
          className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/0 transition-all duration-200 group-hover/item:text-muted-foreground/50"
          strokeWidth={1.5}
        />
      </article>
    </Link>
  );
}

interface SessionListProps {
  sessions: (SessionSummary & { projectTitle?: string; projectSlug?: string })[];
  label: string;
}

export function SessionList({ sessions, label }: SessionListProps) {
  return (
    <section className="mt-12">
      <div className="mb-6 flex items-center gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
          {label}
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="group/list divide-y divide-border/60">
        {sessions.map((session) => (
          <SessionItem key={session.sessionId} session={session} />
        ))}
      </div>
    </section>
  );
}
