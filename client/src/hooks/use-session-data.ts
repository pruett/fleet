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
import type {
  ConnectionInfo,
  LifecycleEvent,
  MessageBatch,
  WsError,
} from "@/lib/ws";
import { useWsClient } from "@/hooks/use-ws-client";
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
  const ws = useWsClient();

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

    // Reset state for clean transition when sessionId changes
    setSession(null);
    setLiveMessages([]);
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    setSessionStatus("unknown");
    setLiveAnalytics(null);

    // --- Event handlers (stable references for cleanup) ---

    const handleConnectionChange = (info: ConnectionInfo) => {
      if (!cancelled) setConnectionInfo(info);
    };

    const handleLifecycle = (event: LifecycleEvent) => {
      if (cancelled || event.sessionId !== sessionId) return;
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

    const handleWsError = (err: WsError) => {
      if (cancelled) return;
      console.warn("[ws] Server error:", err.code, err.message);
      toast.error(`Server error: ${err.message}`);
    };

    const handleReconnect = () => {
      if (cancelled) return;
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
          setLiveMessages(novel.length > 0 ? novel : []);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          refetchingRef.current = false;
          reconnectBufferRef.current = [];

          // Clear stale liveMessages on failed refetch so the UI doesn't show
          // potentially duplicated or outdated data.
          setLiveMessages([]);
          toast.error(
            err instanceof Error
              ? err.message
              : "Failed to refresh session after reconnect",
          );
        });
    };

    // Track whether the initial REST fetch has resolved. Messages that
    // arrive before the baseline is ready are buffered and drained once
    // the fetch completes — this closes the race between ws.subscribe()
    // (which tells the server to start streaming) and the REST fetch.
    const baselineReadyRef = { current: false };
    const initialBufferRef = { current: [] as ParsedMessage[] };

    const handleMessage = (batch: MessageBatch) => {
      console.debug(
        `[DEBUG:hook:handleMessage] msgs=${batch.messages.length} cancelled=${cancelled} refetching=${refetchingRef.current} baselineReady=${baselineReadyRef.current}`,
      );
      if (cancelled) return;

      // Buffer during reconnect refetch (existing logic)
      if (refetchingRef.current) {
        console.debug(`[DEBUG:hook:handleMessage] → buffered to reconnectBuffer (${reconnectBufferRef.current.length + batch.messages.length} total)`);
        reconnectBufferRef.current.push(...batch.messages);
        return;
      }

      // Buffer until initial baseline is ready
      if (!baselineReadyRef.current) {
        console.debug(`[DEBUG:hook:handleMessage] → buffered to initialBuffer (${initialBufferRef.current.length + batch.messages.length} total)`);
        initialBufferRef.current.push(...batch.messages);
        return;
      }

      setLiveMessages((prev) => {
        const liveIndexes = new Set(prev.map((m) => m.lineIndex));
        const novel = batch.messages.filter(
          (m) =>
            !baselineRef.current.has(m.lineIndex) &&
            !liveIndexes.has(m.lineIndex),
        );
        console.debug(
          `[DEBUG:hook:handleMessage] → dedup: ${batch.messages.length} in, ${novel.length} novel, ${prev.length} existing live, baseline size=${baselineRef.current.size}`,
        );
        return novel.length > 0 ? [...prev, ...novel] : prev;
      });

      if (incrementalCtxRef.current) {
        setLiveAnalytics((prev) =>
          prev
            ? applyBatch(prev, batch.messages, incrementalCtxRef.current!)
            : prev,
        );
      }
    };

    // Wire up ALL event listeners before subscribing so no frames are missed
    ws.on("message", handleMessage);
    ws.on("connection-change", handleConnectionChange);
    ws.on("lifecycle", handleLifecycle);
    ws.on("error", handleWsError);
    ws.on("reconnect", handleReconnect);

    ws.subscribe(sessionId);

    fetchSession(sessionId)
      .then((data) => {
        if (cancelled) return;

        setSession(data);
        setLiveAnalytics(extractAnalytics(data));
        incrementalCtxRef.current = createIncrementalContext(data);
        setLoading(false);
        baselineRef.current = new Set(data.messages.map((m) => m.lineIndex));

        // Drain any messages that arrived while the REST fetch was in-flight
        const buffered = initialBufferRef.current;
        initialBufferRef.current = [];
        baselineReadyRef.current = true;

        console.debug(
          `[DEBUG:hook:baselineReady] baseline=${baselineRef.current.size} msgs, buffered=${buffered.length} msgs`,
        );

        const novel = buffered.filter(
          (m) => !baselineRef.current.has(m.lineIndex),
        );
        console.debug(
          `[DEBUG:hook:baselineReady] novel after dedup=${novel.length}`,
        );
        if (novel.length > 0) {
          setLiveMessages(novel);
        }

        if (novel.length > 0 && incrementalCtxRef.current) {
          setLiveAnalytics((prev) =>
            prev
              ? applyBatch(prev, novel, incrementalCtxRef.current!)
              : prev,
          );
        }
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
      ws.unsubscribe();
      ws.off("message", handleMessage);
      ws.off("connection-change", handleConnectionChange);
      ws.off("lifecycle", handleLifecycle);
      ws.off("error", handleWsError);
      ws.off("reconnect", handleReconnect);
    };
  }, [ws, sessionId, retryCount]);

  // -- Computed values ------------------------------------------------------

  const visibleMessages = useMemo(() => {
    const baselineIndexes = session
      ? new Set(session.messages.map((m) => m.lineIndex))
      : new Set<number>();
    const uniqueLive = liveMessages.filter(
      (m) => !baselineIndexes.has(m.lineIndex),
    );
    const allMessages = session ? [...session.messages, ...uniqueLive] : [];
    const visible = allMessages.filter(isVisibleMessage);
    console.debug(
      `[DEBUG:hook:visibleMessages] baseline=${baselineIndexes.size} live=${liveMessages.length} uniqueLive=${uniqueLive.length} total=${allMessages.length} visible=${visible.length}`,
    );
    return visible;
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
