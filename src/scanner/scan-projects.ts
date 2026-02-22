import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectSummary } from "./types";
import { scanSessions } from "./scan-sessions";

/**
 * Decode a project directory name to a display path.
 * Replaces all `-` with `/`.
 * e.g. "-Users-foo-code-bar" → "/Users/foo/code/bar"
 */
function decodePath(dirName: string): string {
  return dirName.replaceAll("-", "/");
}

/**
 * Scan one or more base directories for project dirs.
 * Returns merged results sorted by `lastActiveAt` descending.
 */
export async function scanProjects(
  basePaths: string[],
): Promise<ProjectSummary[]> {
  // Read all base path directories in parallel
  const dirResults = await Promise.all(
    basePaths.map(async (basePath) => {
      try {
        const entries = await readdir(basePath, { withFileTypes: true });
        return { basePath, entries };
      } catch {
        return null;
      }
    }),
  );

  // Collect all project candidates across base paths
  const candidates: Array<{ basePath: string; dirName: string }> = [];
  for (const result of dirResults) {
    if (!result) continue;
    for (const entry of result.entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "memory") continue;
      candidates.push({ basePath: result.basePath, dirName: entry.name });
    }
  }

  // Scan all project directories in parallel
  const projects = await Promise.all(
    candidates.map(async ({ basePath, dirName }) => {
      const sessions = await scanSessions(join(basePath, dirName));
      return {
        id: dirName,
        source: basePath,
        path: decodePath(dirName),
        sessionCount: sessions.length,
        lastActiveAt: sessions[0]?.lastActiveAt ?? null,
      } satisfies ProjectSummary;
    }),
  );

  // Sort by lastActiveAt descending; nulls sort last
  projects.sort((a, b) => {
    if (a.lastActiveAt === null && b.lastActiveAt === null) return 0;
    if (a.lastActiveAt === null) return 1;
    if (b.lastActiveAt === null) return -1;
    return b.lastActiveAt.localeCompare(a.lastActiveAt);
  });

  return projects;
}
