import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      retry: false, // api.ts already retries 5xx via requestWithRetry
      refetchOnWindowFocus: false, // refresh is explicit via button
    },
  },
});
