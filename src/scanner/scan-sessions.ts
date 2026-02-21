import { readdir } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import type { SessionSummary } from "./types";
import { extractSessionSummary } from "./extract-session-summary";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Scan a project directory for session files and return summaries.
 * Sorted by `lastActiveAt` descending.
 */
export async function scanSessions(
  projectDir: string,
): Promise<SessionSummary[]> {
  let entries;
  try {
    entries = await readdir(projectDir, { withFileTypes: true });
  } catch {
    // Missing or unreadable project dir — return empty
    return [];
  }

  const sessions: SessionSummary[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (extname(entry.name) !== ".jsonl") continue;

    const stem = basename(entry.name, ".jsonl");
    if (!UUID_RE.test(stem)) continue;

    const filePath = join(projectDir, entry.name);
    const summary = await extractSessionSummary(filePath, stem);
    sessions.push(summary);
  }

  // Sort by lastActiveAt descending; nulls sort last
  sessions.sort((a, b) => {
    if (a.lastActiveAt === null && b.lastActiveAt === null) return 0;
    if (a.lastActiveAt === null) return 1;
    if (b.lastActiveAt === null) return -1;
    return b.lastActiveAt.localeCompare(a.lastActiveAt);
  });

  return sessions;
}
