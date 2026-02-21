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
  const projects: ProjectSummary[] = [];

  for (const basePath of basePaths) {
    let entries;
    try {
      entries = await readdir(basePath, { withFileTypes: true });
    } catch {
      // Missing or unreadable base path — silently skip
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "memory") continue;

      const projectDir = join(basePath, entry.name);
      const sessions = await scanSessions(projectDir);

      projects.push({
        id: entry.name,
        source: basePath,
        path: decodePath(entry.name),
        sessionCount: sessions.length,
        // scanSessions returns sorted by lastActiveAt desc, so first is most recent
        lastActiveAt: sessions[0]?.lastActiveAt ?? null,
      });
    }
  }

  // Sort by lastActiveAt descending; nulls sort last
  projects.sort((a, b) => {
    if (a.lastActiveAt === null && b.lastActiveAt === null) return 0;
    if (a.lastActiveAt === null) return 1;
    if (b.lastActiveAt === null) return -1;
    return b.lastActiveAt.localeCompare(a.lastActiveAt);
  });

  return projects;
}
