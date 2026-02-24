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
import { isVisibleMessage } from "@/components/conversation/MessageComponent";
import {
  type AnalyticsFields,
  type IncrementalContext,
  applyBatch,
  createIncrementalContext,
  extractAnalytics,
} from "@/lib/incremental-analytics";

// ---------------------------------------------------------------------------
// Helpers (shared with SessionView)
// ---------------------------------------------------------------------------

/** Extract key metadata from the enriched session for the header bar. */
export function getSessionMeta(session: EnrichedSession) {
  const model = session.responses[0]?.model ?? null;

  const firstPrompt = session.messages.find(
    (m): m is UserPromptMessage => m.kind === "user-prompt" && !m.isMeta,
  );
  const startedAt = firstPrompt?.timestamp ?? null;

  return { model, startedAt };
}

/** Format a token count with locale separators. */
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format a USD cost value. */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

export type SessionStatus = "unknown" | "running" | "stopped" | "error";

export const statusConfig: Record<
  SessionStatus,
  { label: string; variant: "secondary" | "default" | "destructive"; dotClass: string | null }
> = {
  unknown: { label: "Unknown", variant: "secondary", dotClass: null },
  running: { label: "Running", variant: "default", dotClass: "bg-green-500" },
  stopped: { label: "Stopped", variant: "secondary", dotClass: "bg-muted-foreground" },
  error: { label: "Error", variant: "destructive", dotClass: "bg-red-400" },
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSessionDataOptions {
  sessionId: string;
  projectId?: string | null;
  onGoSession?: (sessionId: string) => void;
}

export interface UseSessionDataResult {
  // Data
  session: EnrichedSession | null;
  loading: boolean;
  error: string | null;
  errorStatus: number | null;
  sessionStatus: SessionStatus;
  connectionInfo: ConnectionInfo | null;
  analyticsOpen: boolean;
  setAnalyticsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  analytics: AnalyticsFields | null;

  // Computed
  visibleMessages: ParsedMessage[];
  displayTotals: EnrichedSession["totals"] | undefined;
  displayTurns: EnrichedSession["turns"] | undefined;
  analyticsSession: EnrichedSession | null;
  sessionMeta: { model: string | null; startedAt: string | null } | null;

  // Actions
  handleStop: () => void;
  handleResume: () => void;
  handleNewSession: () => void;
  handleSendMessage: () => void;
  handleTextareaKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  retry: () => void;

  // Input state
  messageInput: string;
  setMessageInput: (value: string) => void;
  sendingMessage: boolean;
  actionLoading: string | null;

  // Refs
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useSessionData({
  sessionId,
  projectId,
  onGoSession,
}: UseSessionDataOptions): UseSessionDataResult {
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

  // -- Action handlers ------------------------------------------------------

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

  function retry() {
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    setRetryCount((c) => c + 1);
  }

  // -- WS + REST lifecycle --------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let ws: WsClient | null = null;

    fetchSession(sessionId)
      .then((data) => {
        if (cancelled) return;

        setSession(data);
        setAnalytics(extractAnalytics(data));
        incrementalCtxRef.current = createIncrementalContext(data);
        setLoading(false);
        baselineRef.current = new Set(data.messages.map((m) => m.lineIndex));

        ws = createWsClient();
        wsRef.current = ws;
        ws.subscribe(sessionId);

        ws.onMessage = (batch: MessageBatch) => {
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

          const ctx = incrementalCtxRef.current;
          if (ctx) {
            setAnalytics((prev) =>
              prev ? applyBatch(prev, batch.messages, ctx) : prev,
            );
          }
        };

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

        ws.onConnectionChange = (info) => {
          if (!cancelled) setConnectionInfo(info);
        };

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

    return () => {
      cancelled = true;
      if (ws) {
        ws.unsubscribe();
        ws.close();
      }
      wsRef.current = null;
    };
  }, [sessionId, retryCount]);

  // -- Computed values ------------------------------------------------------

  const baselineIndexes = session
    ? new Set(session.messages.map((m) => m.lineIndex))
    : new Set<number>();
  const uniqueLive = liveMessages.filter(
    (m) => !baselineIndexes.has(m.lineIndex),
  );
  const allMessages = session ? [...session.messages, ...uniqueLive] : [];
  const visibleMessages = allMessages.filter(isVisibleMessage);

  const sessionMeta = session ? getSessionMeta(session) : null;
  const displayTotals = analytics?.totals ?? session?.totals;
  const displayTurns = analytics?.turns ?? session?.turns;
  const analyticsSession =
    session && analytics ? { ...session, ...analytics } : session;

  return {
    session,
    loading,
    error,
    errorStatus,
    sessionStatus,
    connectionInfo,
    analyticsOpen,
    setAnalyticsOpen,
    analytics,
    visibleMessages,
    displayTotals,
    displayTurns,
    analyticsSession,
    sessionMeta,
    handleStop,
    handleResume,
    handleNewSession,
    handleSendMessage,
    handleTextareaKeyDown,
    retry,
    messageInput,
    setMessageInput,
    sendingMessage,
    actionLoading,
    textareaRef,
  };
}
