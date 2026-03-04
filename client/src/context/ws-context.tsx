import { createContext, useEffect, useState, type ReactNode } from "react";
import { createWsClient, type WsClient } from "@/lib/ws";

export const WsContext = createContext<WsClient | null>(null);

/**
 * Provides a single shared WebSocket connection to the component tree.
 *
 * Mount once near the app root (after QueryClientProvider, inside BrowserRouter).
 * All hooks that need WebSocket access call `useWsClient()`.
 *
 * The client is created inside useEffect so that React StrictMode's
 * mount → cleanup → remount cycle works correctly — the destroyed client
 * from the first mount is never served to children.
 */
export function WsProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<WsClient | null>(null);

  useEffect(() => {
    const ws = createWsClient();
    setClient(ws);
    return () => {
      ws.destroy();
      setClient(null);
    };
  }, []);

  if (!client) return null;

  return (
    <WsContext.Provider value={client}>
      {children}
    </WsContext.Provider>
  );
}
