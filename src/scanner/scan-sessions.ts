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

  const candidates = entries.filter((e) => {
    if (e.isDirectory()) return false;
    if (extname(e.name) !== ".jsonl") return false;
    return UUID_RE.test(basename(e.name, ".jsonl"));
  });

  const sessions = await Promise.all(
    candidates.map((e) =>
      extractSessionSummary(join(projectDir, e.name), basename(e.name, ".jsonl")),
    ),
  );

  // Sort by lastActiveAt descending; nulls sort last
  sessions.sort((a, b) => {
    if (a.lastActiveAt === null && b.lastActiveAt === null) return 0;
    if (a.lastActiveAt === null) return 1;
    if (b.lastActiveAt === null) return -1;
    return b.lastActiveAt.localeCompare(a.lastActiveAt);
  });

  return sessions;
}
