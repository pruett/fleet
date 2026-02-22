import { readFile } from "node:fs/promises";
import { computeCost } from "../parser/pricing";
import type { SessionSummary } from "./types";

interface ResponseUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Extract a summary from a single `.jsonl` session file.
 * Reads the entire file and performs a single forward pass to extract
 * header metadata and collect assistant token usage (deduplicated by
 * message.id, keeping last occurrence). A backward scan finds the most
 * recent timestamp for `lastActiveAt`.
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
  let model: string | null = null;
  let headerDone = false;

  // Deduplicated usage per response: message.id → last occurrence's usage
  const responseUsage = new Map<string, ResponseUsage>();

  // Single forward pass: header extraction + assistant usage collection
  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    // --- Header extraction (until first non-meta user record) ---
    if (!headerDone) {
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

      if (record.type === "user") {
        const msg = record.message as Record<string, unknown> | undefined;
        if (msg && !record.isMeta) {
          let text: string | null = null;
          if (typeof msg.content === "string") {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            const textBlock = (msg.content as Array<Record<string, unknown>>).find(
              (b) => b.type === "text" && typeof b.text === "string",
            );
            if (textBlock) {
              text = textBlock.text as string;
            }
          }
          if (text !== null) {
            firstPrompt = text.length > 200 ? text.slice(0, 200) : text;
            cwd = typeof record.cwd === "string" ? record.cwd : null;
            gitBranch =
              typeof record.gitBranch === "string" ? record.gitBranch : null;
            headerDone = true;
          }
        }
      }
    }

    // --- Assistant records: extract model + usage ---
    if (record.type === "assistant") {
      const msg = record.message as Record<string, unknown> | undefined;
      if (msg) {
        const msgId = msg.id as string | undefined;
        const msgModel = msg.model as string | undefined;
        const usage = msg.usage as Record<string, unknown> | undefined;

        // First assistant record sets the session model
        if (model === null && typeof msgModel === "string") {
          model = msgModel;
        }

        if (typeof msgId === "string" && usage) {
          responseUsage.set(msgId, {
            model: typeof msgModel === "string" ? msgModel : "",
            inputTokens:
              typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
            outputTokens:
              typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
            cacheCreationInputTokens:
              typeof usage.cache_creation_input_tokens === "number"
                ? usage.cache_creation_input_tokens
                : 0,
            cacheReadInputTokens:
              typeof usage.cache_read_input_tokens === "number"
                ? usage.cache_read_input_tokens
                : 0,
          });
        }
      }
    }
  }

  // Sum deduplicated usage across all responses and compute cost per response
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let cost = 0;

  for (const usage of responseUsage.values()) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheCreationInputTokens += usage.cacheCreationInputTokens;
    cacheReadInputTokens += usage.cacheReadInputTokens;
    cost += computeCost(
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheCreationInputTokens,
      usage.cacheReadInputTokens,
      usage.model,
    );
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
      if (
        record.type === "file-history-snapshot" &&
        typeof (record.snapshot as Record<string, unknown>)?.timestamp === "string"
      ) {
        lastActiveAt = (record.snapshot as Record<string, unknown>).timestamp as string;
        break;
      }
    } catch {
      continue;
    }
  }

  return {
    sessionId,
    firstPrompt,
    model,
    startedAt,
    lastActiveAt,
    cwd,
    gitBranch,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    cost,
  };
}

function emptySummary(sessionId: string): SessionSummary {
  return {
    sessionId,
    firstPrompt: null,
    model: null,
    startedAt: null,
    lastActiveAt: null,
    cwd: null,
    gitBranch: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cost: 0,
  };
}
