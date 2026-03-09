import { useQuery } from "@tanstack/react-query";
import { fetchRecentSessions } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useRecentSessions(limit = 10) {
  const query = useQuery({
    queryKey: queryKeys.recentSessions(limit),
    queryFn: () => fetchRecentSessions(limit),
  });

  return {
    sessions: query.data ?? [],
    loading: query.isLoading,
  };
}
