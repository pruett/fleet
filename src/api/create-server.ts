import { createApp } from "./create-app";
import type { AppDependencies } from "./types";

/**
 * Bun-compatible server options for HTTP only (no WebSocket).
 * Spread into `Bun.serve({ port, ...createServer(deps) })`.
 */
export interface ServerOptions {
  fetch: (req: Request) => Response | Promise<Response>;
}

/**
 * Create a Bun server configuration that routes all HTTP requests
 * to the Hono app.
 */
export function createServer(deps: AppDependencies): ServerOptions {
  const app = createApp(deps);

  return {
    fetch(req: Request) {
      return app.fetch(req);
    },
  };
}
