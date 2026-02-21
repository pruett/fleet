import type { z } from "zod";
import type {
  ParsedMessageSchema,
  FileHistorySnapshotMessageSchema,
  UserPromptMessageSchema,
  UserToolResultMessageSchema,
  AssistantBlockMessageSchema,
  SystemTurnDurationMessageSchema,
  SystemApiErrorMessageSchema,
  SystemLocalCommandMessageSchema,
  ProgressAgentMessageSchema,
  ProgressBashMessageSchema,
  ProgressHookMessageSchema,
  QueueOperationMessageSchema,
  MalformedRecordSchema,
  ContentBlockSchema,
  TokenUsageSchema,
} from "./schemas";

// ============================================================
// Inferred types from Zod schemas
// ============================================================

export type ParsedMessage = z.infer<typeof ParsedMessageSchema>;
export type FileHistorySnapshotMessage = z.infer<typeof FileHistorySnapshotMessageSchema>;
export type UserPromptMessage = z.infer<typeof UserPromptMessageSchema>;
export type UserToolResultMessage = z.infer<typeof UserToolResultMessageSchema>;
export type AssistantBlockMessage = z.infer<typeof AssistantBlockMessageSchema>;
export type SystemTurnDurationMessage = z.infer<typeof SystemTurnDurationMessageSchema>;
export type SystemApiErrorMessage = z.infer<typeof SystemApiErrorMessageSchema>;
export type SystemLocalCommandMessage = z.infer<typeof SystemLocalCommandMessageSchema>;
export type ProgressAgentMessage = z.infer<typeof ProgressAgentMessageSchema>;
export type ProgressBashMessage = z.infer<typeof ProgressBashMessageSchema>;
export type ProgressHookMessage = z.infer<typeof ProgressHookMessageSchema>;
export type QueueOperationMessage = z.infer<typeof QueueOperationMessageSchema>;
export type MalformedRecord = z.infer<typeof MalformedRecordSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// ============================================================
// Enrichment types (manual — not Zod-validated)
// ============================================================

export interface Turn {
  turnIndex: number;
  promptText: string;
  promptUuid: string;
  durationMs: number | null;
  responseCount: number;
  toolUseCount: number;
  isMeta: boolean;
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
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
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
}
