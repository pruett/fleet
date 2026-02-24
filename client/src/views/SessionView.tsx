import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ApiError,
  fetchSession,
  startSession,
  stopSession,
  resumeSession,
  sendMessage,
} from "@/lib/api";
import { timeAgo } from "@/lib/time";
import {
  createWsClient,
  type ConnectionInfo,
  type LifecycleEvent,
  type MessageBatch,
  type WsClient,
} from "@/lib/ws";
import type {
  EnrichedSession,
  ParsedMessage,
  UserPromptMessage,
} from "@/types/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Conversation,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/conversation/Conversation";
import {
  CollapsibleGroupProvider,
  ExpandCollapseToggle,
} from "@/components/conversation/CollapsibleGroup";
import { isVisibleMessage } from "@/components/conversation/MessageComponent";
import {
  TurnGroup,
  groupMessagesByTurn,
} from "@/components/conversation/TurnGroup";
import { AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import {
  type AnalyticsFields,
  type IncrementalContext,
  applyBatch,
  createIncrementalContext,
  extractAnalytics,
} from "@/lib/incremental-analytics";

interface SessionViewProps {
  sessionId: string;
  projectId?: string | null;
  onBack: () => void;
  onGoProject?: () => void;
  onGoSession?: (sessionId: string) => void;
}

/** Extract key metadata from the enriched session for the header bar. */
function getSessionMeta(session: EnrichedSession) {
  const model = session.responses[0]?.model ?? null;

  const firstPrompt = session.messages.find(
    (m): m is UserPromptMessage => m.kind === "user-prompt" && !m.isMeta,
  );
  const startedAt = firstPrompt?.timestamp ?? null;

  return { model, startedAt };
}

/** Format a token count with locale separators. */
function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format a USD cost value. */
function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

type SessionStatus = "unknown" | "running" | "stopped" | "error";

const statusConfig: Record<
  SessionStatus,
  { label: string; variant: "secondary" | "default" | "destructive"; dotClass: string | null }
> = {
  unknown: { label: "Unknown", variant: "secondary", dotClass: null },
  running: { label: "Running", variant: "default", dotClass: "bg-green-500" },
  stopped: { label: "Stopped", variant: "secondary", dotClass: "bg-muted-foreground" },
  error: { label: "Error", variant: "destructive", dotClass: "bg-red-400" },
};

function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant}>
      {config.dotClass && (
        <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
      )}
      {config.label}
    </Badge>
  );
}

function ConnectionStatusIndicator({ info }: { info: ConnectionInfo | null }) {
  if (!info || info.status === "connected" || info.status === "disconnected") {
    return null;
  }

  if (info.status === "connecting") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-yellow-500">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
        Connecting…
      </span>
    );
  }

  // reconnecting
  return (
    <span className="flex items-center gap-1.5 text-xs text-red-500">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
      Reconnecting… ({info.attempt})
    </span>
  );
}

export function SessionView({
  sessionId,
  projectId,
  onBack,
  onGoProject,
  onGoSession,
}: SessionViewProps) {
  const [session, setSession] = useState<EnrichedSession | null>(null);
  const [liveMessages, setLiveMessages] = useState<ParsedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("unknown");
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsFields | null>(null);

  const wsRef = useRef<WsClient | null>(null);
  const baselineRef = useRef<Set<number>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const incrementalCtxRef = useRef<IncrementalContext | null>(null);
  const refetchingRef = useRef(false);
  const reconnectBufferRef = useRef<ParsedMessage[]>([]);

  async function handleStop() {
    setActionLoading("stop");
    try {
      await stopSession(sessionId);
      toast.success("Session stopped");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to stop session");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResume() {
    setActionLoading("resume");
    try {
      await resumeSession(sessionId);
      toast.success("Session resumed");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to resume session",
      );
    } finally {
      setActionLoading(null);
    }
  }

  async function handleNewSession() {
    if (!projectId) return;
    setActionLoading("new");
    try {
      const newSessionId = await startSession(projectId);
      toast.success("New session started");
      onGoSession?.(newSessionId);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start session",
      );
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSendMessage() {
    const trimmed = messageInput.trim();
    if (!trimmed || sendingMessage) return;
    setSendingMessage(true);
    try {
      await sendMessage(sessionId, trimmed);
      setMessageInput("");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setSendingMessage(false);
    }
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      textareaRef.current?.blur();
    }
  }

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      const isInInput =
        tag === "input" || tag === "textarea" || tag === "select";

      // "/" anywhere (when not in an input) → focus message input
      if (e.key === "/" && !isInInput) {
        e.preventDefault();
        textareaRef.current?.focus();
        return;
      }

      // "Backspace" (when not in an input) → navigate back
      if (e.key === "Backspace" && !isInInput) {
        e.preventDefault();
        onBack();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  // Load sequence: fetch EnrichedSession → render → open WS → subscribe
  // Unload sequence: unsubscribe → close on navigate away or sessionId change
  useEffect(() => {
    let cancelled = false;
    let ws: WsClient | null = null;

    // Step 1: Fetch EnrichedSession via REST
    fetchSession(sessionId)
      .then((data) => {
        if (cancelled) return;

        // Step 2: Render conversation + analytics (state update triggers render)
        setSession(data);
        setAnalytics(extractAnalytics(data));
        incrementalCtxRef.current = createIncrementalContext(data);
        setLoading(false);
        baselineRef.current = new Set(data.messages.map((m) => m.lineIndex));

        // Step 3-4: Open WS connection and subscribe
        ws = createWsClient();
        wsRef.current = ws;
        ws.subscribe(sessionId);

        // Deduplicate incoming WS messages against both baseline and live
        ws.onMessage = (batch: MessageBatch) => {
          // If a reconnect re-fetch is in progress, buffer messages and
          // apply them after the new baseline is available.
          if (refetchingRef.current) {
            reconnectBufferRef.current.push(...batch.messages);
            return;
          }

          setLiveMessages((prev) => {
            const liveIndexes = new Set(prev.map((m) => m.lineIndex));
            const novel = batch.messages.filter(
              (m) =>
                !baselineRef.current.has(m.lineIndex) &&
                !liveIndexes.has(m.lineIndex),
            );
            return novel.length > 0 ? [...prev, ...novel] : prev;
          });

          // Incremental analytics update
          const ctx = incrementalCtxRef.current;
          if (ctx) {
            setAnalytics((prev) =>
              prev ? applyBatch(prev, batch.messages, ctx) : prev,
            );
          }
        };

        // Update session status from lifecycle events
        ws.onLifecycleEvent = (event: LifecycleEvent) => {
          if (event.sessionId !== sessionId) return;
          switch (event.type) {
            case "session:started":
              setSessionStatus("running");
              break;
            case "session:stopped":
              setSessionStatus("stopped");
              break;
            case "session:error":
              setSessionStatus("error");
              break;
          }
        };

        // Track connection status for the indicator
        ws.onConnectionChange = (info) => {
          if (!cancelled) setConnectionInfo(info);
        };

        // On reconnect: re-fetch full session, clear live messages and analytics,
        // re-subscribe (handled automatically by WsClient).
        // Buffer WS messages during re-fetch and flush novel ones after.
        ws.onReconnect = () => {
          refetchingRef.current = true;
          reconnectBufferRef.current = [];

          fetchSession(sessionId)
            .then((freshData) => {
              if (cancelled) return;
              setSession(freshData);
              setAnalytics(extractAnalytics(freshData));
              const freshCtx = createIncrementalContext(freshData);
              incrementalCtxRef.current = freshCtx;
              const freshBaseline = new Set(
                freshData.messages.map((m) => m.lineIndex),
              );
              baselineRef.current = freshBaseline;

              // Flush buffered WS messages that arrived during re-fetch
              const buffered = reconnectBufferRef.current;
              reconnectBufferRef.current = [];
              refetchingRef.current = false;

              const novel = buffered.filter(
                (m) => !freshBaseline.has(m.lineIndex),
              );
              if (novel.length > 0) {
                setLiveMessages(novel);
                setAnalytics((prev) =>
                  prev ? applyBatch(prev, novel, freshCtx) : prev,
                );
              } else {
                setLiveMessages([]);
              }
            })
            .catch((err: unknown) => {
              if (cancelled) return;
              refetchingRef.current = false;
              reconnectBufferRef.current = [];
              toast.error(
                err instanceof Error
                  ? err.message
                  : "Failed to refresh session after reconnect",
              );
            });
        };
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load session",
          );
          setErrorStatus(err instanceof ApiError ? err.status : null);
          setLoading(false);
        }
      });

    // Unload: send unsubscribe and close WS on navigate away or sessionId change
    return () => {
      cancelled = true;
      if (ws) {
        ws.unsubscribe();
        ws.close();
      }
      wsRef.current = null;
    };
  }, [sessionId, retryCount]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground">Loading session…</p>
      </div>
    );
  }

  if (error) {
    // 404: show "Session not found" with link back to project list
    if (errorStatus === 404) {
      return (
        <div className="flex min-h-svh items-center justify-center">
          <Alert className="max-w-md">
            <AlertTitle>Session not found</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <p>The session could not be found. It may have been deleted or the ID is invalid.</p>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={onBack}
              >
                Back to projects
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return (
      <div className="flex min-h-svh items-center justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Failed to load session</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                setLoading(true);
                setError(null);
                setErrorStatus(null);
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

  if (!session) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground">Session not found</p>
      </div>
    );
  }

  // Combine baseline (REST) messages with live (WS) messages, deduplicating
  const baselineIndexes = new Set(session.messages.map((m) => m.lineIndex));
  const uniqueLive = liveMessages.filter(
    (m) => !baselineIndexes.has(m.lineIndex),
  );
  const allMessages = [...session.messages, ...uniqueLive];

  // Filter to visible messages (hidden kinds and meta prompts excluded)
  const visibleMessages = allMessages.filter(isVisibleMessage);

  const meta = getSessionMeta(session);

  // Use live analytics for the metadata bar and AnalyticsPanel
  const displayTotals = analytics?.totals ?? session.totals;
  const displayTurns = analytics?.turns ?? session.turns;
  const analyticsSession = analytics
    ? { ...session, ...analytics }
    : session;

  const projectName = projectId
    ? (projectId.split("/").filter(Boolean).pop() ?? projectId)
    : null;

  return (
    <div className="flex h-svh flex-col">
      {/* Header with breadcrumb navigation */}
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Breadcrumb>
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
            {projectName && onGoProject && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink
                    href={`#/project/${encodeURIComponent(projectId!)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onGoProject();
                    }}
                  >
                    {projectName}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Session</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center gap-3">
          <ConnectionStatusIndicator info={connectionInfo} />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setAnalyticsOpen((prev) => !prev)}
            aria-label={analyticsOpen ? "Hide analytics" : "Show analytics"}
            title={analyticsOpen ? "Hide analytics" : "Show analytics"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {analyticsOpen ? (
                <>
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                  <path d="m10 15-3-3 3-3" />
                </>
              ) : (
                <>
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                  <path d="m10 9 3 3-3 3" />
                </>
              )}
            </svg>
          </Button>
        </div>
      </header>

      {/* Session metadata bar */}
      <div className="flex items-center gap-4 border-b px-6 py-2 text-sm">
        <StatusBadge status={sessionStatus} />
        {meta.model && (
          <span className="text-muted-foreground">{meta.model}</span>
        )}
        {meta.startedAt && (
          <span className="text-muted-foreground">
            Started {timeAgo(meta.startedAt)}
          </span>
        )}
        <span className="text-muted-foreground">
          {formatTokens(displayTotals.totalTokens)} tokens
        </span>
        <span className="text-muted-foreground">
          {formatCost(displayTotals.estimatedCostUsd)}
        </span>
        <span className="text-muted-foreground">
          {displayTurns.length} {displayTurns.length === 1 ? "turn" : "turns"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleStop}
            disabled={actionLoading !== null}
          >
            {actionLoading === "stop" ? "Stopping…" : "Stop"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResume}
            disabled={actionLoading !== null}
          >
            {actionLoading === "resume" ? "Resuming…" : "Resume"}
          </Button>
          {projectId && onGoSession && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewSession}
              disabled={actionLoading !== null}
            >
              {actionLoading === "new" ? "Starting…" : "New Session"}
            </Button>
          )}
        </div>
      </div>

      {/* Two-column content area */}
      <div
        className="grid flex-1 overflow-hidden"
        style={{
          gridTemplateColumns: analyticsOpen ? "1fr 360px" : "1fr",
        }}
      >
        {/* Left: Conversation panel + message input */}
        <div className="flex flex-col overflow-hidden">
          <CollapsibleGroupProvider>
            <Conversation messageCount={visibleMessages.length} className="flex-1 min-h-0 p-6">
              {visibleMessages.length === 0 ? (
                <ConversationEmptyState>No messages yet</ConversationEmptyState>
              ) : (
                <div className="mx-auto flex max-w-3xl flex-col gap-4">
                  <div className="flex justify-end">
                    <ExpandCollapseToggle />
                  </div>
                  {groupMessagesByTurn(visibleMessages).map((group, i) => (
                    <TurnGroup
                      key={group.turnIndex ?? "pre"}
                      group={group}
                      isFirst={i === 0}
                    />
                  ))}
                </div>
              )}
              <ConversationScrollButton />
            </Conversation>
          </CollapsibleGroupProvider>

          {/* Message input */}
          <div className="border-t px-6 py-3">
            <div className="mx-auto flex max-w-3xl gap-2">
              <textarea
                ref={textareaRef}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Send a message…"
                rows={1}
                disabled={sendingMessage}
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              />
              <Button
                size="sm"
                onClick={handleSendMessage}
                disabled={sendingMessage || messageInput.trim().length === 0}
              >
                {sendingMessage ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>

        {/* Right: Analytics panel (uses live-updated analytics) */}
        {analyticsOpen && <AnalyticsPanel session={analyticsSession} />}
      </div>
    </div>
  );
}
