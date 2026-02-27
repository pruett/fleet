import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createWsClient, type WsClient } from "@/lib/ws";

/**
 * Maintains a global WebSocket connection that listens for `session:activity`
 * broadcasts and invalidates the "sessions" query cache so the sidebar
 * auto-refreshes when any session has new activity.
 *
 * Mount once at the top of DashboardView.
 */
export function useSessionActivity(): void {
  const queryClient = useQueryClient();
  const wsRef = useRef<WsClient | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ws = createWsClient();
    wsRef.current = ws;

    ws.onSessionActivity = () => {
      // Client-side debounce (2s) to avoid hammering the query cache
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }, 2_000);
    };

    return () => {
      ws.close();
      wsRef.current = null;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [queryClient]);
}
