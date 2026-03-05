import { createContext, useEffect, useState, type ReactNode } from "react";
import { createWsClient, type WsClient } from "@/lib/ws";

export const WsContext = createContext<WsClient | null>(null);

/**
 * Provides a single shared WebSocket connection to the component tree.
 *
 * Mount once near the app root (after QueryClientProvider, inside BrowserRouter).
 * All hooks that need WebSocket access call `useWsClient()`.
 *
 * The client is created via useState's lazy initializer so it's available on
 * the first render without calling setState inside an effect.
 * useEffect handles cleanup on unmount.
 */
export function WsProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createWsClient());

  useEffect(() => {
    return () => {
      client.destroy();
    };
  }, [client]);

  return (
    <WsContext.Provider value={client}>
      {children}
    </WsContext.Provider>
  );
}
