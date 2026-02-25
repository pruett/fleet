import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { WorktreeSummary } from "./types";

/**
 * Scan a project's `.claude/.worktrees/` directory for worktree subdirectories.
 *
 * @param projectPath Decoded project path on disk, e.g. "/Users/foo/code/bar"
 * @returns Array of worktree summaries sorted alphabetically by name
 */
export async function scanWorktrees(
  projectPath: string,
): Promise<WorktreeSummary[]> {
  const worktreesDir = join(projectPath, ".claude", ".worktrees");

  let entries;
  try {
    entries = await readdir(worktreesDir, { withFileTypes: true });
  } catch {
    // Missing or unreadable directory — return empty
    return [];
  }

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: e.name,
      path: join(worktreesDir, e.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
