import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ServerMessage } from "@/lib/sse";
import type { SessionSummary, RecentSessionSummary } from "@fleet/shared";
import { useSSE } from "@/hooks/use-sse";

const INVALIDATION_DEBOUNCE_MS = 500;

export function useGlobalSSE() {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onEvent = useCallback(
    (event: ServerMessage) => {
      if (
        event.type === "session:started" ||
        event.type === "session:stopped"
      ) {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.sessionsAll(),
          });
          void queryClient.invalidateQueries({
            queryKey: ["recent-sessions"],
          });
        }, INVALIDATION_DEBOUNCE_MS);
      }

      if (event.type === "session:activity") {
        queryClient.setQueriesData<SessionSummary[]>(
          { queryKey: queryKeys.sessionsAll() },
          (old) => {
            if (!old) return old;
            return old.map((s) =>
              s.sessionId === event.sessionId
                ? { ...s, lastActiveAt: event.updatedAt }
                : s,
            );
          },
        );
        queryClient.setQueriesData<RecentSessionSummary[]>(
          { queryKey: ["recent-sessions"] },
          (old) => {
            if (!old) return old;
            return old.map((s) =>
              s.sessionId === event.sessionId
                ? { ...s, lastActiveAt: event.updatedAt }
                : s,
            );
          },
        );
      }
    },
    [queryClient],
  );

  return useSSE({ url: "/api/sse/events", onEvent });
}
