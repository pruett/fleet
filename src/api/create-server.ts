import type { Server, ServerWebSocket } from "bun";
import { createApp } from "./create-app";
import type { AppDependencies } from "./types";

/** Path that accepts WebSocket upgrade requests. */
const WS_PATH = "/ws";

/**
 * Bun-compatible server options combining HTTP (Hono) and WebSocket (Transport).
 * Spread into `Bun.serve({ port, ...createServer(deps) })`.
 */
export interface ServerOptions {
  fetch: (
    req: Request,
    server: Server<undefined>,
  ) => Response | undefined | Promise<Response | undefined>;
  websocket: {
    open: (ws: ServerWebSocket<unknown>) => void;
    message: (ws: ServerWebSocket<unknown>, message: string | Buffer) => void;
    close: (ws: ServerWebSocket<unknown>) => void;
  };
}

/**
 * Create a Bun server configuration that routes WebSocket upgrades on `/ws`
 * to the transport and all other HTTP requests to the Hono app.
 */
export function createServer(deps: AppDependencies): ServerOptions {
  const app = createApp(deps);
  const { transport } = deps;

  return {
    fetch(req: Request, server: Server<undefined>) {
      const url = new URL(req.url);
      if (url.pathname === WS_PATH) {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return app.fetch(req);
    },
    websocket: {
      open(ws) {
        transport.handleOpen(ws);
      },
      message(ws, message) {
        transport.handleMessage(ws, message);
      },
      close(ws) {
        transport.handleClose(ws);
      },
    },
  };
}
