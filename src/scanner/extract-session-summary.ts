import type { SessionSummary } from "./types";

/**
 * Extract a summary from a single `.jsonl` session file.
 * Reads selectively: header lines for metadata, last line for recency.
 */
export async function extractSessionSummary(
  _filePath: string,
  sessionId: string,
): Promise<SessionSummary> {
  // TODO: implement — next task in Phase 0
  return {
    sessionId,
    slug: null,
    firstPrompt: null,
    model: null,
    startedAt: null,
    lastActiveAt: null,
    cwd: null,
    gitBranch: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cost: 0,
  };
}
