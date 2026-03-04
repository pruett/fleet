import { useContext } from "react";
import { WsContext } from "@/context/ws-context";
import type { WsClient } from "@/lib/ws";

/**
 * Access the shared WebSocket client from the nearest `<WsProvider>`.
 *
 * Throws if called outside a provider — this is intentional to catch
 * misconfigured component trees early.
 */
export function useWsClient(): WsClient {
  const client = useContext(WsContext);
  if (!client) {
    throw new Error("useWsClient must be used within a <WsProvider>");
  }
  return client;
}
