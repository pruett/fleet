import type { ContentBlock, TokenUsage } from "./content-blocks.ts";

export interface FileHistorySnapshotMessage {
  kind: "file-history-snapshot";
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, unknown>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
  lineIndex: number;
}

export interface UserPromptMessage {
  kind: "user-prompt";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  text: string;
  isMeta: boolean;
  gitBranch: string | null;
  lineIndex: number;
}

export interface UserToolResultMessage {
  kind: "user-tool-result";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  results: Array<{
    toolUseId: string;
    content: unknown;
    isError: boolean;
  }>;
  toolUseResult: {
    status?: string;
    prompt?: string;
    agentId?: string;
    totalDurationMs?: number;
    totalTokens?: number;
    totalToolUseCount?: number;
    usage?: Record<string, unknown>;
  } | null;
  lineIndex: number;
}

export interface AssistantBlockMessage {
  kind: "assistant-block";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  messageId: string;
  model: string;
  contentBlock: ContentBlock;
  usage: TokenUsage;
  isSynthetic: boolean;
  lineIndex: number;
}

export interface SystemTurnDurationMessage {
  kind: "system-turn-duration";
  parentUuid: string;
  durationMs: number;
  lineIndex: number;
}

export interface SystemApiErrorMessage {
  kind: "system-api-error";
  error: string;
  retryInMs: number;
  retryAttempt: number;
  maxRetries: number;
  lineIndex: number;
}

export interface SystemLocalCommandMessage {
  kind: "system-local-command";
  content: string;
  lineIndex: number;
}

export interface ProgressAgentMessage {
  kind: "progress-agent";
  agentId: string;
  prompt: string;
  parentToolUseID: string;
  lineIndex: number;
}

export interface ProgressBashMessage {
  kind: "progress-bash";
  output: string;
  elapsedTimeSeconds: number;
  lineIndex: number;
}

export interface ProgressHookMessage {
  kind: "progress-hook";
  hookEvent: string;
  hookName: string;
  command: string;
  lineIndex: number;
}

export interface QueueOperationMessage {
  kind: "queue-operation";
  operation: string;
  content?: string;
  lineIndex: number;
}

export interface MalformedRecord {
  kind: "malformed";
  raw: string;
  error: string;
  lineIndex: number;
}

/** Discriminated union of all 12 parsed message kinds */
export type ParsedMessage =
  | FileHistorySnapshotMessage
  | UserPromptMessage
  | UserToolResultMessage
  | AssistantBlockMessage
  | SystemTurnDurationMessage
  | SystemApiErrorMessage
  | SystemLocalCommandMessage
  | ProgressAgentMessage
  | ProgressBashMessage
  | ProgressHookMessage
  | QueueOperationMessage
  | MalformedRecord;
