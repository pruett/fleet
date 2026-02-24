// ============================================================
// Client-side type definitions mirroring server types.
// Duplicated (not imported) to avoid coupling the client build
// to the server's Zod schemas.
//
// Canonical sources:
//   - src/scanner/types.ts  → ProjectSummary, SessionSummary
//   - src/parser/schemas.ts → ParsedMessage (Zod-inferred)
//   - src/parser/types.ts   → EnrichedSession and helpers
// ============================================================

// --- Scanner summary types (src/scanner/types.ts) ---

export interface ProjectSummary {
  /** Raw directory name, e.g. "-Users-foo-code-bar" */
  id: string;
  /** Base path this project was found under */
  source: string;
  /** Decoded display path, e.g. "/Users/foo/code/bar" */
  path: string;
  /** Number of top-level .jsonl session files */
  sessionCount: number;
  /** ISO 8601 timestamp from the most recent session, or null if empty */
  lastActiveAt: string | null;
}

export interface SessionSummary {
  /** UUID from the session filename */
  sessionId: string;
  /** First non-meta user message, truncated to 200 chars */
  firstPrompt: string | null;
  /** Model used, e.g. "claude-opus-4-6" */
  model: string | null;
  /** ISO 8601 timestamp of session start */
  startedAt: string | null;
  /** ISO 8601 timestamp of last activity */
  lastActiveAt: string | null;
  /** Working directory at session start */
  cwd: string | null;
  /** Git branch at session start */
  gitBranch: string | null;
  /** Input tokens excluding cached tokens */
  inputTokens: number;
  /** Output tokens (deduplicated by response) */
  outputTokens: number;
  /** Cache creation input tokens */
  cacheCreationInputTokens: number;
  /** Cache read input tokens */
  cacheReadInputTokens: number;
  /** Estimated cost in USD */
  cost: number;
}

// --- Content blocks & token usage (src/parser/schemas.ts) ---

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  service_tier?: string;
}

// --- Parsed message kinds (src/parser/schemas.ts) ---

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

// --- Enrichment types (src/parser/types.ts) ---

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
