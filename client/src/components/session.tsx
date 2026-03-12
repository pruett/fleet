import * as React from "react"
import { Link } from "react-router"
import { ChevronRight, SquareDot } from "lucide-react"
import type { SessionSummary } from "@fleet/shared"

import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { truncate } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  ItemActions,
  ItemGroup,
  ItemSeparator,
} from "@/components/ui/item"

type SessionData = SessionSummary & {
  projectTitle?: string
  projectSlug?: string
  projectColor?: string
}

// --- List-level components ---

function SessionList({
  className,
  children,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="session-list"
      className={cn("mt-10", className)}
      {...props}
    >
      <ItemGroup>{children}</ItemGroup>
    </section>
  )
}

function SessionListHeader({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="session-list-header"
      className={cn(
        "scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0",
        className,
      )}
      {...props}
    />
  )
}

// --- Item-level components ---

const SessionItemContext = React.createContext<SessionData | null>(null)

function useSessionItem() {
  const ctx = React.useContext(SessionItemContext)
  if (!ctx) throw new Error("SessionItem.* components must be used within <SessionItem>")
  return ctx
}

function SessionItem({
  className,
  session,
  isLast,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "to"> & {
  session: SessionData
  isLast?: boolean
}) {
  const slug = session.projectSlug ?? "unknown"
  return (
    <SessionItemContext.Provider value={session}>
      <Item
        size="sm"
        render={
          <Link
            to={`/projects/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(session.sessionId)}`}
            className={className}
            {...props}
          >
            {children}
          </Link>
        }
      />
      {!isLast && <ItemSeparator />}
    </SessionItemContext.Provider>
  )
}

function SessionItemIcon({ className, ...props }: React.ComponentProps<"div">) {
  const session = useSessionItem()
  return (
    <ItemMedia className={className} {...props}>
      <SquareDot
        className="size-4"
        style={{ color: session.projectColor }}
      />
    </ItemMedia>
  )
}

function SessionItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  const session = useSessionItem()
  return (
    <ItemTitle className={className} {...props}>
      {session.projectTitle ?? "Unknown Project"}
    </ItemTitle>
  )
}

function SessionItemId({ className, ...props }: React.ComponentProps<"span">) {
  const session = useSessionItem()
  return (
    <Badge
      variant="secondary"
      className={cn("font-mono text-xs px-1.5 py-0", className)}
      {...props}
    >
      {session.sessionId.slice(0, 8)}
    </Badge>
  )
}

function SessionItemPrompt({ className, ...props }: React.ComponentProps<"p">) {
  const session = useSessionItem()
  return (
    <ItemDescription className={cn("line-clamp-1", className)} {...props}>
      {truncate(session.firstPrompt, 80, session.sessionId)}
    </ItemDescription>
  )
}

function SessionItemTime({ className, ...props }: React.ComponentProps<"span">) {
  const session = useSessionItem()
  if (!session.lastActiveAt) return null
  return (
    <span
      className={cn("text-xs text-muted-foreground whitespace-nowrap", className)}
      {...props}
    >
      {timeAgo(session.lastActiveAt)}
    </span>
  )
}

function SessionItemChevron({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={className} {...props}>
      <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100" />
    </div>
  )
}

// --- Re-exports for convenience ---

export {
  SessionList,
  SessionListHeader,
  SessionItem,
  SessionItemIcon,
  SessionItemTitle,
  SessionItemId,
  SessionItemPrompt,
  SessionItemTime,
  SessionItemChevron,
  ItemContent as SessionItemContent,
  ItemTitle as SessionItemHeader,
  ItemActions as SessionItemActions,
}
