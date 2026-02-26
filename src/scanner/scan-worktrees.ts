import { execFile as cpExecFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { WorktreeSummary } from "./types";

const defaultExec = promisify(cpExecFile);

type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

/**
 * Parse `git worktree list --porcelain` output into worktree entries.
 *
 * Porcelain format: blocks separated by blank lines, each containing:
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<name>   (or "detached" if detached HEAD)
 */
export function parseWorktreeListOutput(stdout: string): WorktreeSummary[] {
  if (!stdout.trim()) return [];

  const blocks = stdout.trim().split(/\n\n/);

  // First block is always the main worktree — skip it
  const linkedBlocks = blocks.slice(1);

  return linkedBlocks.map((block) => {
    const lines = block.split("\n");
    let worktreePath = "";
    let branch: string | null = null;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length);
      } else if (line.startsWith("branch refs/heads/")) {
        branch = line.slice("branch refs/heads/".length);
      }
    }

    return {
      name: basename(worktreePath),
      path: worktreePath,
      branch,
    };
  });
}

/**
 * Scan a project for git worktrees using `git worktree list --porcelain`.
 *
 * @param projectPath Decoded project path on disk, e.g. "/Users/foo/code/bar"
 * @param exec Optional exec function for testing (defaults to child_process.execFile)
 * @returns Array of linked worktree summaries sorted alphabetically by name
 */
export async function scanWorktrees(
  projectPath: string,
  exec: ExecFn = defaultExec,
): Promise<WorktreeSummary[]> {
  try {
    const { stdout } = await exec(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd: projectPath },
    );
    return parseWorktreeListOutput(stdout).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    // Not a git repo, git not installed, or other error — return empty
    return [];
  }
}
