import type { SessionSummary } from "./types";

/**
 * Scan a project directory for session files and return summaries.
 * Sorted by `lastActiveAt` descending.
 */
export async function scanSessions(
  _projectDir: string,
): Promise<SessionSummary[]> {
  // TODO: implement — next task in Phase 0
  return [];
}
