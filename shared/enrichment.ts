import type { ContentBlock, TokenUsage } from "./content-blocks.ts";
import type { ParsedMessage } from "./messages.ts";

export interface Turn {
  turnIndex: number;
  promptText: string;
  promptUuid: string;
  durationMs: number | null;
  responseCount: number;
  toolUseCount: number;
}

export interface ReconstitutedResponse {
  messageId: string;
  model: string;
  blocks: ContentBlock[];
  usage: TokenUsage;
  isSynthetic: boolean;
  turnIndex: number | null;
  lineIndexStart: number;
  lineIndexEnd: number;
}

export interface PairedToolCall {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseBlock: Extract<ContentBlock, { type: "tool_use" }>;
  toolResultBlock: {
    toolUseId: string;
    content: unknown;
    isError: boolean;
  } | null;
  turnIndex: number | null;
}

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  toolUseCount: number;
}

export interface ToolStat {
  toolName: string;
  callCount: number;
  errorCount: number;
  errorSamples: Array<{
    toolUseId: string;
    errorText: string;
    turnIndex: number | null;
  }>;
}

export interface SubagentRef {
  agentId: string;
  prompt: string;
  parentToolUseID: string;
  stats: {
    totalDurationMs: number;
    totalTokens: number;
    totalToolUseCount: number;
  } | null;
}

export interface ContextSnapshot {
  messageId: string;
  turnIndex: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface EnrichedSession {
  messages: ParsedMessage[];
  turns: Turn[];
  responses: ReconstitutedResponse[];
  toolCalls: PairedToolCall[];
  totals: TokenTotals;
  toolStats: ToolStat[];
  subagents: SubagentRef[];
  contextSnapshots: ContextSnapshot[];
  contextWindowSize: number | null;
  gitBranch: string | null;
}
