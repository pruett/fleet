import type {
  AssistantBlockMessage,
  EnrichedSession,
  ParsedMessage,
} from "@/types/api";

/**
 * Analytics fields extracted from EnrichedSession that can be
 * incrementally updated from live WebSocket message batches.
 */
export type AnalyticsFields = Pick<
  EnrichedSession,
  "totals" | "toolStats" | "contextSnapshots" | "turns" | "responses"
>;

/** Mutable context for tracking deduplication state across batches. */
export interface IncrementalContext {
  /** messageIds already accounted for in token totals. */
  seenMessageIds: Set<string>;
  /** Maps tool_use block IDs to their tool names for error attribution. */
  toolUseIdToName: Map<string, string>;
  /** Average cost-per-token from the REST baseline (for rough estimation). */
  costPerToken: number;
}

/** Initialize incremental tracking context from the REST baseline session. */
export function createIncrementalContext(
  session: EnrichedSession,
): IncrementalContext {
  const seenMessageIds = new Set(session.responses.map((r) => r.messageId));

  const toolUseIdToName = new Map<string, string>();
  for (const tc of session.toolCalls) {
    toolUseIdToName.set(tc.toolUseId, tc.toolName);
  }

  const costPerToken =
    session.totals.totalTokens > 0
      ? session.totals.estimatedCostUsd / session.totals.totalTokens
      : 0;

  return { seenMessageIds, toolUseIdToName, costPerToken };
}

/** Extract initial analytics fields from a REST-fetched session. */
export function extractAnalytics(session: EnrichedSession): AnalyticsFields {
  return {
    totals: session.totals,
    toolStats: session.toolStats,
    contextSnapshots: session.contextSnapshots,
    turns: session.turns,
    responses: session.responses,
  };
}

/**
 * Apply a batch of new messages to the analytics state, returning
 * updated analytics fields. Mutates `ctx` tracking sets but returns
 * a new state object (immutable from React's perspective).
 *
 * Returns `prev` by reference when nothing changed (React skips re-render).
 */
export function applyBatch(
  prev: AnalyticsFields,
  messages: ParsedMessage[],
  ctx: IncrementalContext,
): AnalyticsFields {
  // Shallow-clone top-level fields so we can mutate locally
  let totals = { ...prev.totals };
  const toolStats = prev.toolStats.map((s) => ({
    ...s,
    errorSamples: [...s.errorSamples],
  }));
  const contextSnapshots = [...prev.contextSnapshots];
  const turns = prev.turns.map((t) => ({ ...t }));
  const responses = [...prev.responses];

  // Group assistant blocks by messageId for response reconstitution
  const newBlocks = new Map<string, AssistantBlockMessage[]>();
  let changed = false;

  for (const msg of messages) {
    switch (msg.kind) {
      case "assistant-block": {
        const block = msg.contentBlock;

        // Collect for response reconstitution
        const group = newBlocks.get(msg.messageId);
        if (group) {
          group.push(msg);
        } else {
          newBlocks.set(msg.messageId, [msg]);
        }

        // Token accounting — count once per messageId
        if (!ctx.seenMessageIds.has(msg.messageId)) {
          ctx.seenMessageIds.add(msg.messageId);
          changed = true;

          const u = msg.usage;
          const input = u.input_tokens;
          const output = u.output_tokens;
          const cacheRead = u.cache_read_input_tokens ?? 0;
          const cacheCreate = u.cache_creation_input_tokens ?? 0;
          const added = input + output + cacheRead + cacheCreate;
          const newTotal = totals.totalTokens + added;

          totals = {
            ...totals,
            inputTokens: totals.inputTokens + input,
            outputTokens: totals.outputTokens + output,
            cacheReadInputTokens: totals.cacheReadInputTokens + cacheRead,
            cacheCreationInputTokens:
              totals.cacheCreationInputTokens + cacheCreate,
            totalTokens: newTotal,
            estimatedCostUsd:
              ctx.costPerToken > 0
                ? newTotal * ctx.costPerToken
                : totals.estimatedCostUsd,
          };

          // Context snapshot for this new response
          const prevSnap = contextSnapshots[contextSnapshots.length - 1];
          contextSnapshots.push({
            messageId: msg.messageId,
            turnIndex:
              turns.length > 0
                ? turns[turns.length - 1].turnIndex
                : null,
            cumulativeInputTokens:
              (prevSnap?.cumulativeInputTokens ?? 0) + input + cacheRead,
            cumulativeOutputTokens:
              (prevSnap?.cumulativeOutputTokens ?? 0) + output,
          });
        }

        // Tool use tracking
        if (block.type === "tool_use") {
          changed = true;
          ctx.toolUseIdToName.set(block.id, block.name);
          totals = { ...totals, toolUseCount: totals.toolUseCount + 1 };

          const existing = toolStats.find((s) => s.toolName === block.name);
          if (existing) {
            existing.callCount += 1;
          } else {
            toolStats.push({
              toolName: block.name,
              callCount: 1,
              errorCount: 0,
              errorSamples: [],
            });
          }
        }
        break;
      }

      case "user-tool-result": {
        // Attribute errors to the correct tool via the ID→name map
        for (const result of msg.results) {
          if (result.isError) {
            const toolName = ctx.toolUseIdToName.get(result.toolUseId);
            if (toolName) {
              changed = true;
              const stat = toolStats.find((s) => s.toolName === toolName);
              if (stat) {
                stat.errorCount += 1;
                stat.errorSamples.push({
                  toolUseId: result.toolUseId,
                  errorText:
                    typeof result.content === "string"
                      ? result.content.slice(0, 200)
                      : "Error",
                  turnIndex:
                    turns.length > 0
                      ? turns[turns.length - 1].turnIndex
                      : null,
                });
              }
            }
          }
        }
        break;
      }

      case "user-prompt": {
        if (!msg.isMeta) {
          changed = true;
          const nextIndex =
            turns.length > 0
              ? turns[turns.length - 1].turnIndex + 1
              : 1;
          turns.push({
            turnIndex: nextIndex,
            promptText: msg.text,
            promptUuid: msg.uuid,
            durationMs: null,
            responseCount: 0,
            toolUseCount: 0,
          });
        }
        break;
      }

      case "system-turn-duration": {
        if (turns.length > 0) {
          changed = true;
          turns[turns.length - 1] = {
            ...turns[turns.length - 1],
            durationMs: msg.durationMs,
          };
        }
        break;
      }
    }
  }

  // Build new ReconstitutedResponse entries from grouped blocks
  for (const [messageId, blocks] of newBlocks) {
    if (!responses.some((r) => r.messageId === messageId)) {
      changed = true;
      const first = blocks[0];
      responses.push({
        messageId,
        model: first.model,
        blocks: blocks.map((b) => b.contentBlock),
        usage: first.usage,
        isSynthetic: first.isSynthetic,
        turnIndex:
          turns.length > 0 ? turns[turns.length - 1].turnIndex : null,
        lineIndexStart: Math.min(...blocks.map((b) => b.lineIndex)),
        lineIndexEnd: Math.max(...blocks.map((b) => b.lineIndex)),
      });
    }
  }

  // Short-circuit: return same reference if nothing changed
  if (!changed) return prev;

  return { totals, toolStats, contextSnapshots, turns, responses };
}
