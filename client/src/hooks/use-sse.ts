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
      console.debug("[sse] connected to", url);
      setStatus("connected");
      onOpenRef.current?.();
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CONNECTING) {
        console.debug("[sse] reconnecting…");
        setStatus("reconnecting");
      } else {
        console.debug("[sse] disconnected");
        setStatus("disconnected");
      }
      onErrorRef.current?.();
    };

    // Listen for named events
    for (const type of SERVER_EVENT_TYPES) {
      es.addEventListener(type, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          console.debug(`[sse] ← ${type}`, data);
          onEventRef.current(data as ServerMessage);
        } catch {
          console.warn("[sse] Failed to parse event data:", event.data);
        }
      });
    }

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [url, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  return { status, retry };
}
