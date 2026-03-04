import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "@fleet/shared";
import {
  type AnalyticsFields,
  type IncrementalContext,
  applyBatch,
  createIncrementalContext,
  extractAnalytics,
} from "@/lib/incremental-analytics";
import { isVisibleMessage } from "@/components/conversation/message-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract key metadata from the enriched session for the header bar. */
export function getSessionMeta(session: EnrichedSession) {
  const model = session.responses[0]?.model ?? null;

  const firstPrompt = session.messages.find(
    (m): m is UserPromptMessage => m.kind === "user-prompt" && !m.isMeta,
  );
  const startedAt = firstPrompt?.timestamp ?? null;
  const gitBranch = session.gitBranch;

  return { model, startedAt, gitBranch };
}

export type SessionStatus = "unknown" | "running" | "stopped" | "error";

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

  // Computed
  visibleMessages: ParsedMessage[];
  sessionMeta: { model: string | null; startedAt: string | null; gitBranch: string | null } | null;
  liveAnalytics: AnalyticsFields | null;

  // Actions
  handleStop: () => void;
  handleResume: () => void;
  handleNewSession: () => void;
  handleSendMessage: (text: string) => Promise<void>;
  retry: () => void;

  // Input state
  sendingMessage: boolean;
  actionLoading: string | null;
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("unknown");
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [liveAnalytics, setLiveAnalytics] = useState<AnalyticsFields | null>(null);
  const wsRef = useRef<WsClient | null>(null);
  const baselineRef = useRef<Set<number>>(new Set());
  const refetchingRef = useRef(false);
  const reconnectBufferRef = useRef<ParsedMessage[]>([]);
  const incrementalCtxRef = useRef<IncrementalContext | null>(null);

  const sendingRef = useRef(false);

  // -- Action handlers ------------------------------------------------------

  const handleStop = useCallback(async () => {
    setActionLoading("stop");
    try {
      await stopSession(sessionId);
      toast.success("Session stopped");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to stop session");
    } finally {
      setActionLoading(null);
    }
  }, [sessionId]);

  const handleResume = useCallback(async () => {
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
  }, [sessionId]);

  const handleNewSession = useCallback(async () => {
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
  }, [projectId, onGoSession]);

  const handleSendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current) return;
    sendingRef.current = true;
    setSendingMessage(true);
    try {
      await sendMessage(sessionId, trimmed);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send message",
      );
      throw err; // Re-throw so PromptInput preserves input on failure
    } finally {
      sendingRef.current = false;
      setSendingMessage(false);
    }
  }, [sessionId]);

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
        setLiveAnalytics(extractAnalytics(data));
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

          // Incrementally update analytics from the batch
          if (incrementalCtxRef.current) {
            setLiveAnalytics((prev) =>
              prev
                ? applyBatch(prev, batch.messages, incrementalCtxRef.current!)
                : prev,
            );
          }
        };

        ws.onLifecycleEvent = (event: LifecycleEvent) => {
          if (event.sessionId !== sessionId) return;
          switch (event.type) {
            case "session:started":
            case "session:activity":
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
              setLiveAnalytics(extractAnalytics(freshData));
              incrementalCtxRef.current = createIncrementalContext(freshData);
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

  const visibleMessages = useMemo(() => {
    const baselineIndexes = session
      ? new Set(session.messages.map((m) => m.lineIndex))
      : new Set<number>();
    const uniqueLive = liveMessages.filter(
      (m) => !baselineIndexes.has(m.lineIndex),
    );
    const allMessages = session ? [...session.messages, ...uniqueLive] : [];
    return allMessages.filter(isVisibleMessage);
  }, [session, liveMessages]);

  const sessionMeta = useMemo(
    () => (session ? getSessionMeta(session) : null),
    [session],
  );
  return {
    session,
    loading,
    error,
    errorStatus,
    sessionStatus,
    connectionInfo,
    visibleMessages,
    sessionMeta,
    liveAnalytics,
    handleStop,
    handleResume,
    handleNewSession,
    handleSendMessage,
    retry,
    sendingMessage,
    actionLoading,
  };
}
