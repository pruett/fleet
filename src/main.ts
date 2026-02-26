import { homedir } from "node:os";
import { join } from "node:path";
import { createServer, createResolveSessionPath } from "./api";
import { createTransport } from "./transport";
import { scanProjects, scanSessions, groupProjects, scanWorktrees } from "./scanner";
import { parseFullSession } from "./parser";
import { watchSession, stopWatching } from "./watcher";
import { readPreferences, writePreferences } from "./preferences";

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

const controller = {
  startSession: async () =>
    ({ ok: false, sessionId: "", error: "Not implemented" }) as const,
  stopSession: async () =>
    ({ ok: false, sessionId: "", error: "Not implemented" }) as const,
  resumeSession: async () =>
    ({ ok: false, sessionId: "", error: "Not implemented" }) as const,
  sendMessage: async () =>
    ({ ok: false, sessionId: "", error: "Not implemented" }) as const,
};

const serverOptions = createServer({
  scanner: { scanProjects, scanSessions, groupProjects, scanWorktrees },
  parser: { parseFullSession },
  controller,
  preferences: { readPreferences, writePreferences },
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
  transport.shutdown();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
