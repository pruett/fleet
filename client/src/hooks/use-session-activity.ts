import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createWsClient, type WsClient } from "@/lib/ws";

/** How often (ms) to force-invalidate the sessions cache so timeAgo() stays fresh. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Maintains a global WebSocket connection that listens for session lifecycle
 * and activity broadcasts, invalidating the "sessions" query cache so the
 * sidebar auto-refreshes.
 *
 * Also runs a periodic poll (30s) as a fallback to keep `timeAgo()` timestamps
 * fresh and catch any events that slip through.
 *
 * Mount once at the top of DashboardView.
 */
export function useSessionActivity(): void {
  const queryClient = useQueryClient();
  const wsRef = useRef<WsClient | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ws = createWsClient();
    wsRef.current = ws;

    function scheduleInvalidation(delayMs: number) {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }, delayMs);
    }

    // Lifecycle events from the Controller: started/stopped change the session
    // list, so invalidate quickly.
    ws.onLifecycleEvent = (event) => {
      if (
        event.type === "session:started" ||
        event.type === "session:stopped"
      ) {
        scheduleInvalidation(500);
      }
    };

    // File-change events from the ProjectsDir watcher: data changed on disk
    // (timestamps, tokens, etc.) — debounce since the server already debounces.
    ws.onFileChange = () => {
      scheduleInvalidation(500);
    };

    // Periodic poll so timeAgo() timestamps stay fresh even without events.
    const pollTimer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    }, POLL_INTERVAL_MS);

    return () => {
      ws.close();
      wsRef.current = null;
      clearInterval(pollTimer);
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [queryClient]);
}
