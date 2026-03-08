import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  startSession,
  stopSession,
  resumeSession,
  sendMessage,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ConnectionInfo, ServerMessage } from "@/lib/sse";
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
import { useSSE } from "@/hooks/use-sse";

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
// Hook
// ---------------------------------------------------------------------------

export interface UseSessionOptions {
  sessionId: string;
  projectId?: string | null;
  onSelectSession?: (sessionId: string) => void;
}

export interface UseSessionResult {
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

/** A promise that never resolves — used as a placeholder queryFn when SSE populates the cache. */
function pending(): Promise<never> {
  return new Promise(() => {});
}

export function useSession({
  sessionId,
  projectId,
  onSelectSession,
}: UseSessionOptions): UseSessionResult {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.session(sessionId);

  // --- Live state (connection-scoped, not cacheable) ----------------------

  const [liveMessages, setLiveMessages] = useState<ParsedMessage[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("ready");
  const [liveAnalytics, setLiveAnalytics] = useState<AnalyticsFields | null>(null);
  const incrementalCtxRef = useRef<IncrementalContext | null>(null);
  const sendingRef = useRef(false);

  // Track the sessionId in a ref so onEvent always sees the latest value
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // --- TanStack Query for session data ------------------------------------

  const { data: session, isLoading, error: queryError } = useQuery<EnrichedSession>({
    queryKey,
    queryFn: pending,
  });

  // --- SSE event dispatch → feeds query cache -----------------------------

  const handleSseEvent = useCallback((event: ServerMessage) => {
    switch (event.type) {
      case "snapshot": {
        console.debug("[session] snapshot received —", event.session.messages.length, "messages");
        queryClient.setQueryData(queryKeys.session(sessionIdRef.current), event.session);
        setLiveMessages([]);
        setLiveAnalytics(extractAnalytics(event.session));
        incrementalCtxRef.current = createIncrementalContext(event.session);
        break;
      }
      case "messages": {
        console.debug("[session] messages batch —", event.messages.length, "messages, lineIndexes:", event.messages.map((m) => m.lineIndex));
        setLiveMessages((prev) => {
          const existing = new Set(prev.map((m) => m.lineIndex));
          const novel = event.messages.filter((m) => !existing.has(m.lineIndex));
          console.debug("[session] dedup: %d existing, %d novel, %d total", existing.size, novel.length, prev.length + novel.length);
          return novel.length > 0 ? [...prev, ...novel] : prev;
        });

        if (incrementalCtxRef.current) {
          setLiveAnalytics((prev) =>
            prev
              ? applyBatch(prev, event.messages, incrementalCtxRef.current!)
              : prev,
          );
        }
        break;
      }
      case "session:started":
      case "session:stopped":
      case "session:error":
      case "session:activity": {
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
        console.warn("[sse] Server error:", event.code, event.message);
        toast.error(`Server error: ${event.message}`);
        break;
      }
    }
  }, [queryClient]);

  // --- SSE connection ----------------------------------------------------

  const sseUrl = `/api/sse/sessions/${sessionId}`;

  const { status: sseStatus, retry: sseRetry } = useSSE({
    url: sseUrl,
    onEvent: handleSseEvent,
  });

  // --- Connection info derived from SSE status ---------------------------

  const connectionInfo = useMemo((): ConnectionInfo => {
    switch (sseStatus) {
      case "connecting":
        return { status: "connecting", attempt: 0 };
      case "connected":
        return { status: "connected", attempt: 0 };
      case "reconnecting":
        return { status: "reconnecting", attempt: 0 };
      case "disconnected":
      default:
        return { status: "disconnected", attempt: 0 };
    }
  }, [sseStatus]);

  // -- Action handlers ----------------------------------------------------

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
      onSelectSession?.(newSessionId);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start session",
      );
    } finally {
      setActionLoading(null);
    }
  }, [projectId, onSelectSession]);

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
    queryClient.removeQueries({ queryKey });
    setLiveMessages([]);
    setLiveAnalytics(null);
    sseRetry();
  }

  // -- Computed values ----------------------------------------------------

  const visibleMessages = useMemo(() => {
    const allMessages = session ? [...session.messages, ...liveMessages] : [];
    const visible = allMessages.filter(isVisibleMessage);
    console.debug("[session] visibleMessages: %d snapshot + %d live = %d total, %d visible", session?.messages.length ?? 0, liveMessages.length, allMessages.length, visible.length);
    return visible;
  }, [session, liveMessages]);

  const sessionMeta = useMemo(
    () => (session ? getSessionMeta(session) : null),
    [session],
  );

  return {
    session: session ?? null,
    loading: isLoading,
    error: queryError ? queryError.message : null,
    errorStatus: null,
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
