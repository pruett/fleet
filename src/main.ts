import { homedir } from "node:os";
import { join } from "node:path";
import { createServer, createResolveSessionPath } from "./api";
import { createSse } from "./sse";
import { scanProjects, scanSessions, groupProjects, scanWorktrees } from "./scanner";
import { parseFullSession } from "./parser";
import { watchSession, stopWatching, watchProjectsDir } from "./watcher";
import { readConfig, writeConfig } from "./config";
import { createController } from "./controller";

const port = Number(process.env.FLEET_PORT) || 3000;

const basePaths = process.env.FLEET_BASE_PATHS
  ? process.env.FLEET_BASE_PATHS.split(",").map((p) => p.trim())
  : [join(homedir(), ".claude", "projects")];

const staticDir = process.env.FLEET_STATIC_DIR ?? null;

const sse = createSse({
  watchSession,
  stopWatching,
  resolveSessionPath: createResolveSessionPath(basePaths),
  parseSession: parseFullSession,
});

const controller = createController({
  onLifecycleEvent: (event) => sse.pushEvent(event),
});

const projectsDirWatcher = watchProjectsDir({
  basePaths,
  onNewSession: (sessionId) =>
    sse.pushEvent({
      type: "session:started",
      sessionId,
      startedAt: new Date().toISOString(),
    }),
  onSessionActivity: (sessionId) =>
    sse.pushEvent({
      type: "session:activity",
      sessionId,
      updatedAt: new Date().toISOString(),
    }),
});

const serverOptions = createServer({
  scanner: { scanProjects, scanSessions, groupProjects, scanWorktrees },
  parser: { parseFullSession },
  controller,
  config: { readConfig, writeConfig },
  sse,
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
  projectsDirWatcher.stop();
  controller.shutdown();
  sse.shutdown();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
