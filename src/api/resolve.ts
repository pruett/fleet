import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Resolve a project ID to its directory path by scanning basePaths.
 * Returns the full path to the first matching directory, or null.
 */
export async function resolveProjectDir(
  basePaths: string[],
  projectId: string,
): Promise<string | null> {
  for (const basePath of basePaths) {
    const candidate = join(basePath, projectId);
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        return candidate;
      }
    } catch {
      // Not found or not accessible, try next basePath
    }
  }
  return null;
}

/**
 * Resolve a session ID to its .jsonl file path by scanning basePaths.
 * Searches basePath/{project}/sessionId.jsonl for each basePath.
 * Returns the full path to the first matching file, or null.
 */
export async function resolveSessionFile(
  basePaths: string[],
  sessionId: string,
): Promise<string | null> {
  const fileName = `${sessionId}.jsonl`;

  for (const basePath of basePaths) {
    let entries;
    try {
      entries = await readdir(basePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(basePath, entry.name, fileName);
      try {
        const info = await stat(candidate);
        if (info.isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}
