import { homedir } from "node:os";
import { join } from "node:path";
import { createServer, createResolveSessionPath } from "./api";
import { createRealtime } from "./realtime";
import { scanProjects, scanSessions, groupProjects, scanWorktrees } from "./scanner";
import { parseFullSession } from "./parser";
import { watchSession, stopWatching } from "./watcher";
import { readConfig, writeConfig } from "./config";
import { createController } from "./controller";

const port = Number(process.env.FLEET_PORT) || 3000;

const basePaths = process.env.FLEET_BASE_PATHS
  ? process.env.FLEET_BASE_PATHS.split(",").map((p) => p.trim())
  : [join(homedir(), ".claude", "projects")];

const staticDir = process.env.FLEET_STATIC_DIR ?? null;

const realtime = createRealtime({
  watchSession,
  stopWatching,
  resolveSessionPath: createResolveSessionPath(basePaths),
  parseSession: parseFullSession,
});

const controller = createController({
  onLifecycleEvent: (event) => realtime.pushEvent(event),
});

const serverOptions = createServer({
  scanner: { scanProjects, scanSessions, groupProjects, scanWorktrees },
  parser: { parseFullSession },
  controller,
  config: { readConfig, writeConfig },
  realtime,
  basePaths,
  staticDir,
});

const server = Bun.serve({
  port,
  fetch: serverOptions.fetch,
  // SSE connections are long-lived — disable Bun's idle timeout
  // so streaming responses aren't killed after 10s of inactivity.
  idleTimeout: 255, // max value in seconds (Bun caps at 255)
});

console.log(`Fleet server listening on http://localhost:${server.port}`);

function shutdown() {
  console.log("\nShutting down...");
  controller.shutdown();
  realtime.shutdown();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
