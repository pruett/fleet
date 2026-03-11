import { Link } from "react-router";
import { Folder } from "lucide-react";
import type { SessionSummary } from "@fleet/shared";
import { timeAgo } from "@/lib/time";
import { truncate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface SessionItemProps {
  session: SessionSummary & { projectTitle?: string; projectSlug?: string };
  isLast?: boolean;
}

export function SessionItem({ session, isLast }: SessionItemProps) {
  const slug = session.projectSlug ?? "unknown";
  return (
    <Link
      to={`/projects/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(session.sessionId)}`}
      className="group/item block"
    >
      <article
        className={`relative px-4 py-3.5 transition-colors duration-150 hover:bg-muted/50 ${isLast ? "" : "border-b border-border/40"}`}
      >
        {/* Title */}
        <h3 className="text-sm font-medium leading-snug text-foreground/90 transition-colors duration-150 group-hover/item:text-foreground">
          {truncate(session.firstPrompt, 120, session.sessionId)}
        </h3>

        {/* Metadata badges */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {session.projectTitle && (
            <Badge variant="secondary" className="text-[11px] font-normal text-muted-foreground">
              <Folder className="size-3" strokeWidth={1.5} />
              {session.projectTitle}
            </Badge>
          )}
          <Badge variant="secondary" className="font-mono text-[11px] font-normal text-muted-foreground">
            {session.sessionId.slice(0, 8)}
          </Badge>
          {session.lastActiveAt && (
            <Badge variant="secondary" className="text-[11px] font-normal text-muted-foreground">
              {timeAgo(session.lastActiveAt)}
            </Badge>
          )}
        </div>
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
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-medium text-foreground/70">
        {label}
      </h2>

      <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
        {sessions.map((session, i) => (
          <SessionItem
            key={session.sessionId}
            session={session}
            isLast={i === sessions.length - 1}
          />
        ))}
      </div>
    </section>
  );
}
