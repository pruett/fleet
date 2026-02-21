import { z } from "zod";

// ============================================================
// Common Building Blocks
// ============================================================

/** Fields present on most record types (user, assistant, system — not file-history-snapshot or queue-operation) */
export const CommonFieldsSchema = z.object({
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  sessionId: z.string(),
  timestamp: z.string(),
});

/** Token usage reported on assistant messages */
export const TokenUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  service_tier: z.string().optional(),
});

// --- Content Blocks (inside assistant messages) ---

const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ThinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string(),
});

const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

export const ContentBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ThinkingBlockSchema,
  ToolUseBlockSchema,
]);

// --- Tool result items (inside user messages with array content) ---

const ToolResultItemSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.unknown(),
  is_error: z.boolean().optional(),
});

// --- Tool use result metadata (on user records carrying tool output) ---

const ToolUseResultSchema = z.object({
  status: z.string().optional(),
  prompt: z.string().optional(),
  agentId: z.string().optional(),
  totalDurationMs: z.number().optional(),
  totalTokens: z.number().optional(),
  totalToolUseCount: z.number().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================
// Raw JSONL Record Schemas (what arrives from disk)
// ============================================================

export const FileHistorySnapshotRecordSchema = z.object({
  type: z.literal("file-history-snapshot"),
  messageId: z.string(),
  snapshot: z.object({
    messageId: z.string(),
    trackedFileBackups: z.record(z.string(), z.unknown()),
    timestamp: z.string(),
  }),
  isSnapshotUpdate: z.boolean(),
});

export const UserRecordSchema = CommonFieldsSchema.extend({
  type: z.literal("user"),
  message: z.object({
    role: z.literal("user"),
    content: z.union([z.string(), z.array(ToolResultItemSchema)]),
  }),
  isMeta: z.boolean().optional(),
  toolUseResult: ToolUseResultSchema.optional(),
});

export const AssistantRecordSchema = CommonFieldsSchema.extend({
  type: z.literal("assistant"),
  message: z.object({
    model: z.string(),
    id: z.string(),
    type: z.literal("message"),
    role: z.literal("assistant"),
    content: z.array(ContentBlockSchema).length(1),
    stop_reason: z.string().nullable(),
    stop_sequence: z.string().nullable(),
    usage: TokenUsageSchema,
  }),
  isApiErrorMessage: z.boolean().optional(),
});

export const SystemRecordSchema = z.object({
  type: z.literal("system"),
  subtype: z.string(),
}).passthrough();

export const ProgressRecordSchema = z.object({
  type: z.literal("progress"),
  data: z.object({
    type: z.string(),
  }).passthrough(),
}).passthrough();

export const QueueOperationRecordSchema = z.object({
  type: z.literal("queue-operation"),
  operation: z.string(),
  content: z.string().optional(),
});

/** Top-level discriminated union over the 6 raw JSONL record types */
export const RawRecordSchema = z.discriminatedUnion("type", [
  FileHistorySnapshotRecordSchema,
  UserRecordSchema,
  AssistantRecordSchema,
  SystemRecordSchema,
  ProgressRecordSchema,
  QueueOperationRecordSchema,
]);

// --- System subtype schemas (used in parseLine for precise validation) ---

export const SystemTurnDurationSchema = z.object({
  type: z.literal("system"),
  subtype: z.literal("turn_duration"),
  parentUuid: z.string(),
  durationMs: z.number(),
});

export const SystemApiErrorSchema = z.object({
  type: z.literal("system"),
  subtype: z.literal("api_error"),
  error: z.string(),
  retryInMs: z.number(),
  retryAttempt: z.number(),
  maxRetries: z.number(),
});

export const SystemLocalCommandSchema = z.object({
  type: z.literal("system"),
  subtype: z.literal("local_command"),
  content: z.string(),
});

// --- Progress subtype schemas (used in parseLine for precise validation) ---

export const ProgressAgentSchema = z.object({
  type: z.literal("progress"),
  data: z.object({
    type: z.literal("agent_progress"),
    agentId: z.string(),
    prompt: z.string(),
    parentToolUseID: z.string(),
  }),
});

export const ProgressBashSchema = z.object({
  type: z.literal("progress"),
  data: z.object({
    type: z.literal("bash_progress"),
    output: z.string(),
    elapsedTimeSeconds: z.number(),
  }),
});

export const ProgressHookSchema = z.object({
  type: z.literal("progress"),
  data: z.object({
    type: z.literal("hook_progress"),
    hookEvent: z.string(),
    hookName: z.string(),
    command: z.string(),
  }),
});

// ============================================================
// Parsed Message Schemas (what parseLine outputs)
// ============================================================

export const FileHistorySnapshotMessageSchema = z.object({
  kind: z.literal("file-history-snapshot"),
  messageId: z.string(),
  snapshot: z.object({
    messageId: z.string(),
    trackedFileBackups: z.record(z.string(), z.unknown()),
    timestamp: z.string(),
  }),
  isSnapshotUpdate: z.boolean(),
  lineIndex: z.number(),
});

export const UserPromptMessageSchema = z.object({
  kind: z.literal("user-prompt"),
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  sessionId: z.string(),
  timestamp: z.string(),
  text: z.string(),
  isMeta: z.boolean(),
  lineIndex: z.number(),
});

export const UserToolResultMessageSchema = z.object({
  kind: z.literal("user-tool-result"),
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  sessionId: z.string(),
  timestamp: z.string(),
  results: z.array(
    z.object({
      toolUseId: z.string(),
      content: z.unknown(),
      isError: z.boolean(),
    })
  ),
  toolUseResult: ToolUseResultSchema.nullable(),
  lineIndex: z.number(),
});

export const AssistantBlockMessageSchema = z.object({
  kind: z.literal("assistant-block"),
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  sessionId: z.string(),
  timestamp: z.string(),
  messageId: z.string(),
  model: z.string(),
  contentBlock: ContentBlockSchema,
  usage: TokenUsageSchema,
  isSynthetic: z.boolean(),
  lineIndex: z.number(),
});

export const SystemTurnDurationMessageSchema = z.object({
  kind: z.literal("system-turn-duration"),
  parentUuid: z.string(),
  durationMs: z.number(),
  lineIndex: z.number(),
});

export const SystemApiErrorMessageSchema = z.object({
  kind: z.literal("system-api-error"),
  error: z.string(),
  retryInMs: z.number(),
  retryAttempt: z.number(),
  maxRetries: z.number(),
  lineIndex: z.number(),
});

export const SystemLocalCommandMessageSchema = z.object({
  kind: z.literal("system-local-command"),
  content: z.string(),
  lineIndex: z.number(),
});

export const ProgressAgentMessageSchema = z.object({
  kind: z.literal("progress-agent"),
  agentId: z.string(),
  prompt: z.string(),
  parentToolUseID: z.string(),
  lineIndex: z.number(),
});

export const ProgressBashMessageSchema = z.object({
  kind: z.literal("progress-bash"),
  output: z.string(),
  elapsedTimeSeconds: z.number(),
  lineIndex: z.number(),
});

export const ProgressHookMessageSchema = z.object({
  kind: z.literal("progress-hook"),
  hookEvent: z.string(),
  hookName: z.string(),
  command: z.string(),
  lineIndex: z.number(),
});

export const QueueOperationMessageSchema = z.object({
  kind: z.literal("queue-operation"),
  operation: z.string(),
  content: z.string().optional(),
  lineIndex: z.number(),
});

export const MalformedRecordSchema = z.object({
  kind: z.literal("malformed"),
  raw: z.string(),
  error: z.string(),
  lineIndex: z.number(),
});

/** Discriminated union of all 12 parsed message kinds */
export const ParsedMessageSchema = z.discriminatedUnion("kind", [
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
]);
