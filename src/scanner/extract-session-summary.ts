import { readFile } from "node:fs/promises";
import type { SessionSummary } from "./types";

/**
 * Extract a summary from a single `.jsonl` session file.
 * Reads selectively: header lines for metadata, last line for recency.
 * Token fields are stubbed to zero (implemented in Phase 1).
 */
export async function extractSessionSummary(
  filePath: string,
  sessionId: string,
): Promise<SessionSummary> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return emptySummary(sessionId);
  }

  const lines = content.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    return emptySummary(sessionId);
  }

  let firstPrompt: string | null = null;
  let startedAt: string | null = null;
  let cwd: string | null = null;
  let gitBranch: string | null = null;

  // Scan header lines for metadata (up to first non-meta user record)
  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    // Extract startedAt from earliest available timestamp
    if (startedAt === null) {
      if (typeof record.timestamp === "string") {
        startedAt = record.timestamp;
      } else if (
        record.type === "file-history-snapshot" &&
        typeof (record.snapshot as Record<string, unknown>)?.timestamp ===
          "string"
      ) {
        startedAt = (record.snapshot as Record<string, unknown>)
          .timestamp as string;
      }
    }

    // Look for user records with string content (human prompts)
    if (record.type !== "user") continue;
    const msg = record.message as Record<string, unknown> | undefined;
    if (typeof msg?.content !== "string") continue;
    if (record.isMeta) continue;

    // First non-meta user record — extract header fields and stop
    const text = msg.content as string;
    firstPrompt = text.length > 200 ? text.slice(0, 200) : text;
    cwd = typeof record.cwd === "string" ? record.cwd : null;
    gitBranch = typeof record.gitBranch === "string" ? record.gitBranch : null;
    break;
  }

  // Extract lastActiveAt: scan backwards for a line with a timestamp
  let lastActiveAt: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const record = JSON.parse(lines[i]);
      if (typeof record.timestamp === "string") {
        lastActiveAt = record.timestamp;
        break;
      }
    } catch {
      continue;
    }
  }

  return {
    sessionId,
    slug: null,
    firstPrompt,
    model: null,
    startedAt,
    lastActiveAt,
    cwd,
    gitBranch,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cost: 0,
  };
}

function emptySummary(sessionId: string): SessionSummary {
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
