/**
 * Concurrent dev launcher — runs the Fleet server and Vite client in parallel.
 * Both processes inherit stdout/stderr for unified terminal output.
 * Ctrl+C cleanly shuts down both via AbortController.
 *
 * In git worktrees, ports are automatically offset to avoid conflicts.
 * See scripts/resolve-ports.ts for details.
 */

import { resolvePorts } from "./resolve-ports";

const { server: serverPort, client: clientPort, worktreeName } = resolvePorts();

if (worktreeName) {
  console.log(`[worktree: ${worktreeName}]`);
}
console.log(`Server → http://localhost:${serverPort}`);
console.log(`Client → http://localhost:${clientPort}\n`);

const controller = new AbortController();
const { signal } = controller;

const server = Bun.spawn(["bun", "--watch", "src/main.ts"], {
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, FLEET_PORT: String(serverPort) },
  signal,
});

const client = Bun.spawn(["bun", "run", "--filter", "@fleet/client", "dev"], {
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    ...process.env,
    FLEET_SERVER_PORT: String(serverPort),
    FLEET_CLIENT_PORT: String(clientPort),
  },
  signal,
});

function shutdown() {
  console.log("\nStopping dev servers...");
  controller.abort();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Wait for both to exit
await Promise.allSettled([server.exited, client.exited]);
