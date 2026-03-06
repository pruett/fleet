import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useWebSocket, { ReadyState } from "react-use-websocket";
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
  ServerMessage,
  WsError,
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

export type SessionStatus = "ready" | "working" | "error";

// ---------------------------------------------------------------------------
// WebSocket URL
// ---------------------------------------------------------------------------

const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

/** Compute reconnect delay: min(1000 * 2^attempt, 30000) + jitter(0–500). */
function getReconnectInterval(attempt: number): number {
  const exponential = Math.min(1000 * Math.pow(2, attempt), 30000);
  return exponential + Math.random() * 500;
}

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
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("ready");
  const [liveAnalytics, setLiveAnalytics] = useState<AnalyticsFields | null>(null);
  const baselineRef = useRef<Set<number>>(new Set());
  const refetchingRef = useRef(false);
  const reconnectBufferRef = useRef<ParsedMessage[]>([]);
  const incrementalCtxRef = useRef<IncrementalContext | null>(null);
  const sendingRef = useRef(false);

  // Track whether the initial REST fetch has resolved. Messages that
  // arrive before the baseline is ready are buffered and drained once
  // the fetch completes — this closes the race between ws subscribe
  // (which tells the server to start streaming) and the REST fetch.
  const baselineReadyRef = useRef(false);
  const initialBufferRef = useRef<ParsedMessage[]>([]);

  // Track the sessionId in a ref so onMessage always sees the latest value
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Track whether the effect has been cancelled (sessionId changed)
  const cancelledRef = useRef(false);

  // --- Message dispatch (stable ref to avoid re-creating onMessage) --------

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    if (cancelledRef.current) return;

    switch (msg.type) {
      case "messages": {
        const batch = msg as MessageBatch;

        // Buffer during reconnect refetch
        if (refetchingRef.current) {
          reconnectBufferRef.current.push(...batch.messages);
          return;
        }

        // Buffer until initial baseline is ready
        if (!baselineReadyRef.current) {
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
          return novel.length > 0 ? [...prev, ...novel] : prev;
        });

        if (incrementalCtxRef.current) {
          setLiveAnalytics((prev) =>
            prev
              ? applyBatch(prev, batch.messages, incrementalCtxRef.current!)
              : prev,
          );
        }
        break;
      }
      case "session:started":
      case "session:stopped":
      case "session:error":
      case "session:activity": {
        const event = msg as LifecycleEvent;
        if (event.sessionId !== sessionIdRef.current) return;
        switch (event.type) {
          case "session:started":
            setSessionStatus("working");
            break;
          case "session:stopped":
            setSessionStatus("ready");
            break;
          case "session:error":
            setSessionStatus("error");
            break;
        }
        break;
      }
      case "error": {
        const err = msg as WsError;
        console.warn("[ws] Server error:", err.code, err.message);
        toast.error(`Server error: ${err.message}`);
        break;
      }
      // heartbeat is handled by the library
    }
  }, []);

  // --- react-use-websocket ------------------------------------------------

  const { sendJsonMessage, readyState } = useWebSocket(
    WS_URL,
    {
      shouldReconnect: () => true,
      reconnectAttempts: Infinity,
      reconnectInterval: getReconnectInterval,
      heartbeat: {
        message: () => JSON.stringify({ type: "pong" }),
        returnMessage: JSON.stringify({ type: "heartbeat" }),
        timeout: 60000,
        interval: 30000,
      },
      onOpen: () => {
        // Subscribe to the active session on every connect/reconnect
        sendJsonMessage({ type: "subscribe", sessionId: sessionIdRef.current });
      },
      onMessage: (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          console.warn("[ws] Malformed WebSocket message, discarding:", event.data);
          return;
        }
        handleServerMessage(msg);
      },
      onReconnectStop: () => {
        toast.error("Lost connection to server");
      },
    },
    true,
  );

  // --- Reconnect refetch ---------------------------------------------------

  const prevReadyState = useRef(readyState);
  useEffect(() => {
    const wasDisconnected =
      prevReadyState.current === ReadyState.CLOSED ||
      prevReadyState.current === ReadyState.CLOSING;
    const isNowOpen = readyState === ReadyState.OPEN;
    prevReadyState.current = readyState;

    // Only refetch on reconnect (not initial connect)
    if (!wasDisconnected || !isNowOpen || !session) return;

    refetchingRef.current = true;
    reconnectBufferRef.current = [];

    fetchSession(sessionIdRef.current)
      .then((freshData) => {
        if (cancelledRef.current) return;
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
        if (cancelledRef.current) return;
        refetchingRef.current = false;
        reconnectBufferRef.current = [];
        setLiveMessages([]);
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to refresh session after reconnect",
        );
      });
  }, [readyState, session]);

  // --- Connection info derived from readyState -----------------------------

  const connectionInfo = useMemo((): ConnectionInfo => {
    switch (readyState) {
      case ReadyState.CONNECTING:
        return { status: "connecting", attempt: 0 };
      case ReadyState.OPEN:
        return { status: "connected", attempt: 0 };
      case ReadyState.CLOSING:
      case ReadyState.CLOSED:
        return { status: "reconnecting", attempt: 0 };
      default:
        return { status: "disconnected", attempt: 0 };
    }
  }, [readyState]);

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
    setSessionStatus("working");
    try {
      await sendMessage(sessionId, trimmed);
    } catch (err: unknown) {
      setSessionStatus("ready");
      toast.error(
        err instanceof Error ? err.message : "Failed to send message",
      );
      throw err; // Re-throw so PromptInput preserves input on failure
    } finally {
      sendingRef.current = false;
    }
  }, [sessionId]);

  function retry() {
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    setRetryCount((c) => c + 1);
  }

  // -- Session subscription + REST fetch lifecycle --------------------------

  useEffect(() => {
    cancelledRef.current = false;
    baselineReadyRef.current = false;
    initialBufferRef.current = [];

    // Reset state for clean transition when sessionId changes
    setSession(null);
    setLiveMessages([]);
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    setSessionStatus("ready");
    setLiveAnalytics(null);

    // Send subscribe for this session (if already connected)
    if (readyState === ReadyState.OPEN) {
      sendJsonMessage({ type: "subscribe", sessionId });
    }

    fetchSession(sessionId)
      .then((data) => {
        if (cancelledRef.current) return;

        setSession(data);
        setLiveAnalytics(extractAnalytics(data));
        incrementalCtxRef.current = createIncrementalContext(data);
        setLoading(false);
        baselineRef.current = new Set(data.messages.map((m) => m.lineIndex));

        // Drain any messages that arrived while the REST fetch was in-flight
        const buffered = initialBufferRef.current;
        initialBufferRef.current = [];
        baselineReadyRef.current = true;

        const novel = buffered.filter(
          (m) => !baselineRef.current.has(m.lineIndex),
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
        if (!cancelledRef.current) {
          setError(
            err instanceof Error ? err.message : "Failed to load session",
          );
          setErrorStatus(err instanceof ApiError ? err.status : null);
          setLoading(false);
        }
      });

    return () => {
      cancelledRef.current = true;
      // Unsubscribe from the session on cleanup
      sendJsonMessage({ type: "unsubscribe" });
    };
  }, [sessionId, retryCount, sendJsonMessage, readyState]);

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
    actionLoading,
  };
}
