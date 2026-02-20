import type {
  ParsedMessage,
  AssistantBlockMessage,
  Turn,
  ReconstitutedResponse,
  PairedToolCall,
  TokenTotals,
  ToolStat,
  SubagentRef,
  ContextSnapshot,
  EnrichedSession,
} from "./types";
import { computeCost } from "./pricing";

/**
 * Build cross-message structures from a flat list of parsed messages.
 *
 * Enrichment ordering: turns → response reconstitution → tool pairing → token aggregation → tool stats → subagent refs → context snapshots.
 */
export function enrichSession(messages: ParsedMessage[]): EnrichedSession {
  const turns: Turn[] = [];

  // First pass: build turns and track which turn each lineIndex belongs to
  let currentTurnIndex = -1;
  const lineToTurn = new Map<number, number>();

  for (const msg of messages) {
    if (msg.kind === "user-prompt" && !msg.isMeta) {
      currentTurnIndex++;
      turns.push({
        turnIndex: currentTurnIndex,
        promptText: msg.text,
        promptUuid: msg.uuid,
        durationMs: null,
        responseCount: 0,
        toolUseCount: 0,
        isMeta: false,
      });
    }

    if (msg.kind === "system-turn-duration" && currentTurnIndex >= 0) {
      turns[currentTurnIndex].durationMs = msg.durationMs;
    }

    lineToTurn.set(msg.lineIndex, Math.max(currentTurnIndex, 0));
  }

  // Second pass: group assistant blocks by messageId → reconstituted responses
  const responseMap = new Map<string, AssistantBlockMessage[]>();
  for (const msg of messages) {
    if (msg.kind === "assistant-block") {
      const group = responseMap.get(msg.messageId);
      if (group) group.push(msg);
      else responseMap.set(msg.messageId, [msg]);
    }
  }

  const responses: ReconstitutedResponse[] = [];
  for (const [messageId, blocks] of responseMap) {
    blocks.sort((a, b) => a.lineIndex - b.lineIndex);
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    const turnIdx = lineToTurn.get(first.lineIndex) ?? 0;

    responses.push({
      messageId,
      model: first.model,
      blocks: blocks.map((b) => b.contentBlock),
      usage: last.usage,
      isSynthetic: first.isSynthetic,
      turnIndex: turnIdx,
      lineIndexStart: first.lineIndex,
      lineIndexEnd: last.lineIndex,
    });
  }

  // Update turn response counts
  for (const response of responses) {
    if (response.turnIndex < turns.length) {
      turns[response.turnIndex].responseCount++;
    }
  }

  // Third pass: tool call pairing — match tool_use blocks with tool_result items
  const toolCalls: PairedToolCall[] = [];
  const toolCallMap = new Map<string, PairedToolCall>();

  for (const msg of messages) {
    if (msg.kind === "assistant-block" && msg.contentBlock.type === "tool_use") {
      const block = msg.contentBlock;
      const paired: PairedToolCall = {
        toolUseId: block.id,
        toolName: block.name,
        input: block.input as Record<string, unknown>,
        toolUseBlock: block,
        toolResultBlock: null,
        turnIndex: lineToTurn.get(msg.lineIndex) ?? 0,
      };
      toolCalls.push(paired);
      toolCallMap.set(block.id, paired);
    }
  }

  for (const msg of messages) {
    if (msg.kind === "user-tool-result") {
      for (const result of msg.results) {
        const paired = toolCallMap.get(result.toolUseId);
        if (paired) {
          paired.toolResultBlock = {
            toolUseId: result.toolUseId,
            content: result.content,
            isError: result.isError,
          };
        }
      }
    }
  }

  // Update turn toolUseCount
  for (const tc of toolCalls) {
    if (tc.turnIndex < turns.length) {
      turns[tc.turnIndex].toolUseCount++;
    }
  }

  // Token totals from responses (already deduplicated by messageId)
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let estimatedCostUsd = 0;

  for (const response of responses) {
    const rInput = response.usage.input_tokens;
    const rOutput = response.usage.output_tokens;
    const rCacheWrite = response.usage.cache_creation_input_tokens ?? 0;
    const rCacheRead = response.usage.cache_read_input_tokens ?? 0;

    inputTokens += rInput;
    outputTokens += rOutput;
    cacheCreationInputTokens += rCacheWrite;
    cacheReadInputTokens += rCacheRead;
    estimatedCostUsd += computeCost(rInput, rOutput, rCacheWrite, rCacheRead, response.model);
  }

  const totals: TokenTotals = {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd,
    toolUseCount: toolCalls.length,
  };

  // Tool statistics: count calls, errors, and collect error samples per tool name
  const toolStatMap = new Map<string, ToolStat>();
  for (const tc of toolCalls) {
    let stat = toolStatMap.get(tc.toolName);
    if (!stat) {
      stat = { toolName: tc.toolName, callCount: 0, errorCount: 0, errorSamples: [] };
      toolStatMap.set(tc.toolName, stat);
    }
    stat.callCount++;
    if (tc.toolResultBlock?.isError) {
      stat.errorCount++;
      stat.errorSamples.push({
        toolUseId: tc.toolUseId,
        errorText: String(tc.toolResultBlock.content),
        turnIndex: tc.turnIndex,
      });
    }
  }
  const toolStats = Array.from(toolStatMap.values());

  // Subagent references: correlate progress-agent messages with tool results carrying agentId stats
  const subagentMap = new Map<string, SubagentRef>();

  for (const msg of messages) {
    if (msg.kind === "progress-agent") {
      if (!subagentMap.has(msg.agentId)) {
        subagentMap.set(msg.agentId, {
          agentId: msg.agentId,
          prompt: msg.prompt,
          parentToolUseID: msg.parentToolUseID,
          stats: null,
        });
      }
    }
  }

  for (const msg of messages) {
    if (msg.kind === "user-tool-result" && msg.toolUseResult?.agentId) {
      const ref = subagentMap.get(msg.toolUseResult.agentId);
      if (ref && msg.toolUseResult.totalDurationMs != null && msg.toolUseResult.totalTokens != null && msg.toolUseResult.totalToolUseCount != null) {
        ref.stats = {
          totalDurationMs: msg.toolUseResult.totalDurationMs,
          totalTokens: msg.toolUseResult.totalTokens,
          totalToolUseCount: msg.toolUseResult.totalToolUseCount,
        };
      }
    }
  }

  const subagents = Array.from(subagentMap.values());

  // Context snapshots: cumulative token totals after each non-synthetic response
  const contextSnapshots: ContextSnapshot[] = [];
  let cumulativeInput = 0;
  let cumulativeOutput = 0;

  for (const response of responses) {
    if (response.isSynthetic) continue;
    cumulativeInput += response.usage.input_tokens;
    cumulativeOutput += response.usage.output_tokens;
    contextSnapshots.push({
      messageId: response.messageId,
      turnIndex: response.turnIndex,
      cumulativeInputTokens: cumulativeInput,
      cumulativeOutputTokens: cumulativeOutput,
    });
  }

  return {
    messages,
    turns,
    responses,
    toolCalls,
    totals,
    toolStats,
    subagents,
    contextSnapshots,
  };
}
