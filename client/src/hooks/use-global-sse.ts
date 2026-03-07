import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ServerMessage } from "@/lib/sse";
import { useSSE } from "@/hooks/use-sse";

/**
 * Connects to the global SSE stream (`/api/sse/events`) to receive
 * broadcast lifecycle events (session:started, session:stopped).
 * Invalidates the sessions query cache so the sidebar stays fresh
 * without polling.
 */
export function useGlobalSSE() {
  const queryClient = useQueryClient();

  const onEvent = useCallback(
    (event: ServerMessage) => {
      if (
        event.type === "session:started" ||
        event.type === "session:stopped"
      ) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.sessionsAll(),
        });
      }
    },
    [queryClient],
  );

  return useSSE({ url: "/api/sse/events", onEvent });
}
