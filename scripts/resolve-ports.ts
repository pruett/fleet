/**
 * Port resolution for concurrent worktree dev servers.
 *
 * Main repo keeps defaults (3000 / 5173). Git worktrees get a deterministic
 * offset (1–99) derived from the worktree name via Bun.hash (Wyhash-64).
 * Env vars FLEET_PORT / FLEET_CLIENT_PORT override everything.
 */

const DEFAULT_SERVER_PORT = 3000;
const DEFAULT_CLIENT_PORT = 5173;

/** Return the worktree name if running inside a git worktree, else null. */
export function getWorktreeName(): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", "--git-dir"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const gitDir = result.stdout.toString().trim();

  // Main repo returns ".git"; worktrees return something like
  // "/path/to/repo/.git/worktrees/<name>"
  if (gitDir === ".git" || !gitDir.includes("/worktrees/")) {
    return null;
  }

  const parts = gitDir.split("/worktrees/");
  return parts[parts.length - 1] ?? null;
}

/** Map a worktree name to a stable port offset in the range 1–99. */
export function hashToOffset(name: string): number {
  return Number(Bun.hash(name) % BigInt(99)) + 1;
}

export interface ResolvedPorts {
  server: number;
  client: number;
  worktreeName: string | null;
}

/** Resolve server + client ports. Env vars take priority over computed values. */
export function resolvePorts(): ResolvedPorts {
  const worktreeName = getWorktreeName();
  const offset = worktreeName ? hashToOffset(worktreeName) : 0;

  const server = process.env.FLEET_PORT
    ? Number(process.env.FLEET_PORT)
    : DEFAULT_SERVER_PORT + offset;

  const client = process.env.FLEET_CLIENT_PORT
    ? Number(process.env.FLEET_CLIENT_PORT)
    : DEFAULT_CLIENT_PORT + offset;

  return { server, client, worktreeName };
}
