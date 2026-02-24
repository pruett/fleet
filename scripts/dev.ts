/**
 * Concurrent dev launcher — runs the Fleet server and Vite client in parallel.
 * Both processes inherit stdout/stderr for unified terminal output.
 * Ctrl+C cleanly shuts down both via AbortController.
 */

const controller = new AbortController();
const { signal } = controller;

const server = Bun.spawn(["bun", "--watch", "src/main.ts"], {
  stdio: ["inherit", "inherit", "inherit"],
  signal,
});

const client = Bun.spawn(["bun", "run", "--filter", "@fleet/client", "dev"], {
  stdio: ["inherit", "inherit", "inherit"],
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
