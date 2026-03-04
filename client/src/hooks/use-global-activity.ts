import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createWsClient, type WsClient } from "@/lib/ws";
import { queryKeys } from "@/lib/query-keys";

/** How often (ms) to force-invalidate caches so timeAgo() stays fresh. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Maintains a single global WebSocket connection that listens for
 * `global:activity` events and invalidates the relevant query caches
 * so data-fetching hooks automatically refetch.
 *
 * Also runs a 30s poll to keep `timeAgo()` timestamps fresh.
 *
 * Mount once at the top of DashboardView.
 */
export function useGlobalActivity(): void {
  const queryClient = useQueryClient();
  const wsRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const ws = createWsClient();
    wsRef.current = ws;

    ws.onGlobalActivity = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      queryClient.invalidateQueries({ queryKey: queryKeys.config() });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll() });
    };

    const pollTimer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll() });
    }, POLL_INTERVAL_MS);

    return () => {
      ws.close();
      wsRef.current = null;
      clearInterval(pollTimer);
    };
  }, [queryClient]);
}
