import { homedir } from "node:os";
import { join } from "node:path";
import { createServer, createResolveSessionPath } from "./api";
import { createTransport } from "./transport";
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

const transport = createTransport({
  watchSession,
  stopWatching,
  resolveSessionPath: createResolveSessionPath(basePaths),
});

const projectsDirWatcher = watchProjectsDir({
  basePaths,
  onSessionActivity: () => {
    transport.broadcastGlobalActivity({
      type: "global:activity",
      updatedAt: new Date().toISOString(),
    });
  },
});

const controller = createController({
  onLifecycleEvent: (event) => {
    transport.relayLifecycleEvent(event);
    // Also broadcast started/stopped so sidebar picks them up
    if (event.type === "session:started" || event.type === "session:stopped") {
      transport.broadcastLifecycleEvent(event);
      transport.broadcastGlobalActivity({
        type: "global:activity",
        updatedAt: new Date().toISOString(),
      });
    }
  },
});

const serverOptions = createServer({
  scanner: { scanProjects, scanSessions, groupProjects, scanWorktrees },
  parser: { parseFullSession },
  controller,
  config: { readConfig, writeConfig },
  transport,
  basePaths,
  staticDir,
});

const server = Bun.serve({
  port,
  ...serverOptions,
});

console.log(`Fleet server listening on http://localhost:${server.port}`);

function shutdown() {
  console.log("\nShutting down...");
  controller.shutdown();
  projectsDirWatcher.stop();
  transport.shutdown();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
