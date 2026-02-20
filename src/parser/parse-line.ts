import type { ParsedMessage } from "./types";
import {
  RawRecordSchema,
  SystemTurnDurationSchema,
  SystemApiErrorSchema,
  SystemLocalCommandSchema,
} from "./schemas";

/**
 * Parse a single JSONL line into a typed ParsedMessage.
 *
 * - Empty/blank line → null
 * - Invalid JSON → MalformedRecord
 * - Valid JSON failing Zod validation → MalformedRecord
 * - Valid record → appropriate ParsedMessage variant
 *
 * Never throws.
 */
export function parseLine(line: string, lineIndex: number): ParsedMessage | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      kind: "malformed",
      raw: trimmed,
      error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      lineIndex,
    };
  }

  const result = RawRecordSchema.safeParse(parsed);
  if (!result.success) {
    return {
      kind: "malformed",
      raw: trimmed,
      error: result.error.message,
      lineIndex,
    };
  }

  const record = result.data;

  switch (record.type) {
    case "file-history-snapshot":
      return {
        kind: "file-history-snapshot",
        messageId: record.messageId,
        snapshot: record.snapshot,
        isSnapshotUpdate: record.isSnapshotUpdate,
        lineIndex,
      };

    case "user": {
      const content = record.message.content;
      if (typeof content === "string") {
        return {
          kind: "user-prompt",
          uuid: record.uuid,
          parentUuid: record.parentUuid,
          sessionId: record.sessionId,
          timestamp: record.timestamp,
          text: content,
          isMeta: record.isMeta ?? false,
          lineIndex,
        };
      }
      // Array content = tool result
      return {
        kind: "user-tool-result",
        uuid: record.uuid,
        parentUuid: record.parentUuid,
        sessionId: record.sessionId,
        timestamp: record.timestamp,
        results: content.map((item) => ({
          toolUseId: item.tool_use_id,
          content: item.content,
          isError: item.is_error ?? false,
        })),
        toolUseResult: record.toolUseResult ?? null,
        lineIndex,
      };
    }

    case "assistant": {
      const block = record.message.content[0];
      if (!block) {
        return {
          kind: "malformed",
          raw: trimmed,
          error: "Assistant record has no content blocks",
          lineIndex,
        };
      }
      return {
        kind: "assistant-block",
        uuid: record.uuid,
        parentUuid: record.parentUuid,
        sessionId: record.sessionId,
        timestamp: record.timestamp,
        messageId: record.message.id,
        model: record.message.model,
        contentBlock: block,
        usage: record.message.usage,
        isSynthetic: record.isApiErrorMessage ?? false,
        lineIndex,
      };
    }

    case "system": {
      switch (record.subtype) {
        case "turn_duration": {
          const td = SystemTurnDurationSchema.safeParse(parsed);
          if (!td.success) {
            return {
              kind: "malformed",
              raw: trimmed,
              error: td.error.message,
              lineIndex,
            };
          }
          return {
            kind: "system-turn-duration",
            parentUuid: td.data.parentUuid,
            durationMs: td.data.durationMs,
            lineIndex,
          };
        }
        case "api_error": {
          const ae = SystemApiErrorSchema.safeParse(parsed);
          if (!ae.success) {
            return {
              kind: "malformed",
              raw: trimmed,
              error: ae.error.message,
              lineIndex,
            };
          }
          return {
            kind: "system-api-error",
            error: ae.data.error,
            retryInMs: ae.data.retryInMs,
            retryAttempt: ae.data.retryAttempt,
            maxRetries: ae.data.maxRetries,
            lineIndex,
          };
        }

        case "local_command": {
          const lc = SystemLocalCommandSchema.safeParse(parsed);
          if (!lc.success) {
            return {
              kind: "malformed",
              raw: trimmed,
              error: lc.error.message,
              lineIndex,
            };
          }
          return {
            kind: "system-local-command",
            content: lc.data.content,
            lineIndex,
          };
        }

        default:
          return {
            kind: "malformed",
            raw: trimmed,
            error: `Unhandled system subtype: ${record.subtype}`,
            lineIndex,
          };
      }
    }

    case "progress":
      // Handled in Unit 6
      return {
        kind: "malformed",
        raw: trimmed,
        error: "Progress parsing not yet implemented",
        lineIndex,
      };

    case "queue-operation":
      // Handled in Unit 7
      return {
        kind: "malformed",
        raw: trimmed,
        error: "Queue operation parsing not yet implemented",
        lineIndex,
      };

    default:
      return {
        kind: "malformed",
        raw: trimmed,
        error: "Unknown record type",
        lineIndex,
      };
  }
}
