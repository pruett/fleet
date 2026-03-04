import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createWsClient, type WsClient } from "@/lib/ws";
import { fetchActivity } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { GroupedProject } from "@fleet/shared";

/**
 * Maintains a global WebSocket connection that listens for `global:activity`
 * events and keeps the `["activity"]` query cache populated with fresh
 * `GroupedProject[]` data.
 *
 * Mount once at the top of DashboardView.
 */
export function useGlobalActivity(): GroupedProject[] | undefined {
  const queryClient = useQueryClient();
  const wsRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const ws = createWsClient();
    wsRef.current = ws;

    ws.onGlobalActivity = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activity() });
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [queryClient]);

  const { data } = useQuery({
    queryKey: queryKeys.activity(),
    queryFn: fetchActivity,
  });

  return data;
}
