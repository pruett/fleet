import { useCallback, useEffect, useRef, useState } from "react";
import { type ConnectionStatus, type ServerMessage, SERVER_EVENT_TYPES } from "@/lib/sse";

export interface UseSseOptions {
  /** SSE URL to connect to. Pass null to disable. */
  url: string | null;
  /** Called for each named SSE event. */
  onEvent: (event: ServerMessage) => void;
  /** Called when connection is established. */
  onOpen?: () => void;
  /** Called when connection is lost. */
  onError?: () => void;
}

export interface UseSseResult {
  status: ConnectionStatus;
  retry: () => void;
}

/**
 * Custom hook wrapping the native EventSource API for SSE connections.
 * EventSource provides built-in reconnection with exponential backoff.
 */
export function useSSE({
  url,
  onEvent,
  onOpen,
  onError,
}: UseSseOptions): UseSseResult {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [retryCount, setRetryCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  const onOpenRef = useRef(onOpen);
  const onErrorRef = useRef(onError);

  // Reset to "connecting" when connection params change (React-blessed render-time state adjustment)
  const [prevUrl, setPrevUrl] = useState(url);
  const [prevRetryCount, setPrevRetryCount] = useState(retryCount);
  if (url !== prevUrl || retryCount !== prevRetryCount) {
    setPrevUrl(url);
    setPrevRetryCount(retryCount);
    setStatus(url ? "connecting" : "disconnected");
  }

  useEffect(() => {
    onEventRef.current = onEvent;
    onOpenRef.current = onOpen;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!url) return;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      onOpenRef.current?.();
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CONNECTING) {
        setStatus("reconnecting");
      } else {
        setStatus("disconnected");
      }
      onErrorRef.current?.();
    };

    // Listen for named events
    for (const type of SERVER_EVENT_TYPES) {
      es.addEventListener(type, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          onEventRef.current(data as ServerMessage);
        } catch {
          console.warn("[sse] Failed to parse event data:", event.data);
        }
      });
    }

    // Force reconnect when tab returns from background.
    // Browsers throttle/kill SSE connections in background tabs,
    // and EventSource auto-reconnect may stall. A fresh connection
    // gets a new snapshot covering any messages missed while hidden.
    //
    // Even if readyState is OPEN, the connection may be stale (server
    // closed silently, or the keepalive wasn't received). The server
    // sends keepalive comments every 30s, so if OPEN but hidden for
    // longer than that, force a reconnect to get a fresh snapshot.
    let hiddenAt: number | null = null;
    const STALE_THRESHOLD_MS = 45_000;

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }

      // Tab became visible
      const wasHiddenFor = hiddenAt !== null ? Date.now() - hiddenAt : 0;
      hiddenAt = null;

      if (es.readyState !== EventSource.OPEN) {
        setRetryCount((c) => c + 1);
      } else if (wasHiddenFor > STALE_THRESHOLD_MS) {
        setRetryCount((c) => c + 1);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      es.close();
      eventSourceRef.current = null;
    };
  }, [url, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  return { status, retry };
}
