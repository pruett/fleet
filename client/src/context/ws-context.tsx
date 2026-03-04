import { createContext, useEffect, useRef, type ReactNode } from "react";
import { createWsClient, type WsClient } from "@/lib/ws";

export const WsContext = createContext<WsClient | null>(null);

/**
 * Provides a single shared WebSocket connection to the component tree.
 *
 * Mount once near the app root (after QueryClientProvider, inside BrowserRouter).
 * All hooks that need WebSocket access call `useWsClient()`.
 */
export function WsProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<WsClient | null>(null);

  // Create the client synchronously on first render so it's available
  // immediately for child components (no null flash).
  if (!clientRef.current) {
    clientRef.current = createWsClient();
  }

  useEffect(() => {
    const client = clientRef.current;
    return () => {
      client?.destroy();
      clientRef.current = null;
    };
  }, []);

  return (
    <WsContext.Provider value={clientRef.current}>
      {children}
    </WsContext.Provider>
  );
}
