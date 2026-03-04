import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWsClient } from "@/hooks/use-ws-client";
import { queryKeys } from "@/lib/query-keys";

/** How often (ms) to force-invalidate caches so timeAgo() stays fresh. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Listens for `global:activity` events on the shared WebSocket and
 * invalidates the relevant query caches so data-fetching hooks
 * automatically refetch.
 *
 * Also runs a 30s poll to keep `timeAgo()` timestamps fresh.
 *
 * Mount once at the top of DashboardView.
 */
export function useGlobalActivity(): void {
  const ws = useWsClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleGlobalActivity = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      queryClient.invalidateQueries({ queryKey: queryKeys.config() });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll() });
    };

    ws.on("global-activity", handleGlobalActivity);

    const pollTimer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll() });
    }, POLL_INTERVAL_MS);

    return () => {
      ws.off("global-activity", handleGlobalActivity);
      clearInterval(pollTimer);
    };
  }, [ws, queryClient]);
}
