import { describe, expect, it } from "bun:test";
import {
  CommonFieldsSchema,
  TokenUsageSchema,
  ContentBlockSchema,
  FileHistorySnapshotRecordSchema,
  UserRecordSchema,
  AssistantRecordSchema,
  SystemRecordSchema,
  ProgressRecordSchema,
  QueueOperationRecordSchema,
  RawRecordSchema,
  ParsedMessageSchema,
} from "../schemas";

// ---- Helpers ----

function makeCommonFields(overrides: Record<string, unknown> = {}) {
  return {
    uuid: "test-uuid-1234",
    parentUuid: null,
    sessionId: "session-5678",
    timestamp: "2026-02-18T15:09:10.006Z",
    ...overrides,
  };
}

function makeValidUsage(overrides: Record<string, unknown> = {}) {
  return {
    input_tokens: 100,
    output_tokens: 200,
    ...overrides,
  };
}

function makeAssistantRecord(overrides: Record<string, unknown> = {}) {
  return {
    ...makeCommonFields(),
    type: "assistant" as const,
    message: {
      model: "claude-opus-4-6",
      id: "msg_015kDst",
      type: "message" as const,
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Hello!" }],
      stop_reason: null,
      stop_sequence: null,
      usage: makeValidUsage(),
    },
    ...overrides,
  };
}

// ============================================================
// CommonFieldsSchema
// ============================================================

describe("CommonFieldsSchema", () => {
  it("accepts valid fields", () => {
    const result = CommonFieldsSchema.safeParse(makeCommonFields());
    expect(result.success).toBe(true);
  });

  it("accepts non-null parentUuid", () => {
    const result = CommonFieldsSchema.safeParse(
      makeCommonFields({ parentUuid: "parent-1234" })
    );
    expect(result.success).toBe(true);
  });

  it("rejects missing uuid", () => {
    const { uuid: _, ...rest } = makeCommonFields();
    const result = CommonFieldsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects wrong type for uuid", () => {
    const result = CommonFieldsSchema.safeParse(
      makeCommonFields({ uuid: 123 })
    );
    expect(result.success).toBe(false);
  });

  it("rejects non-nullable parentUuid with undefined", () => {
    const result = CommonFieldsSchema.safeParse(
      makeCommonFields({ parentUuid: undefined })
    );
    expect(result.success).toBe(false);
  });
});

// ============================================================
// TokenUsageSchema
// ============================================================

describe("TokenUsageSchema", () => {
  it("accepts valid usage with all fields", () => {
    const result = TokenUsageSchema.safeParse({
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 150,
      service_tier: "standard",
    });
    expect(result.success).toBe(true);
  });

  it("accepts usage with only required fields", () => {
    const result = TokenUsageSchema.safeParse(makeValidUsage());
    expect(result.success).toBe(true);
  });

  it("rejects missing input_tokens", () => {
    const result = TokenUsageSchema.safeParse({ output_tokens: 200 });
    expect(result.success).toBe(false);
  });

  it("rejects wrong type for output_tokens", () => {
    const result = TokenUsageSchema.safeParse({
      input_tokens: 100,
      output_tokens: "200",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// ContentBlockSchema
// ============================================================

describe("ContentBlockSchema", () => {
  it("accepts a text block", () => {
    const result = ContentBlockSchema.safeParse({
      type: "text",
      text: "hello",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("text");
  });

  it("accepts a thinking block", () => {
    const result = ContentBlockSchema.safeParse({
      type: "thinking",
      thinking: "hmm...",
      signature: "sig123",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("thinking");
  });

  it("accepts a tool_use block", () => {
    const result = ContentBlockSchema.safeParse({
      type: "tool_use",
      id: "toolu_123",
      name: "Read",
      input: { file_path: "/test" },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("tool_use");
  });

  it("rejects unknown type", () => {
    const result = ContentBlockSchema.safeParse({
      type: "image",
      url: "...",
    });
    expect(result.success).toBe(false);
  });

  it("rejects text block missing text field", () => {
    const result = ContentBlockSchema.safeParse({ type: "text" });
    expect(result.success).toBe(false);
  });

  it("rejects thinking block missing signature", () => {
    const result = ContentBlockSchema.safeParse({
      type: "thinking",
      thinking: "hmm...",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// FileHistorySnapshotRecordSchema
// ============================================================

describe("FileHistorySnapshotRecordSchema", () => {
  const valid = {
    type: "file-history-snapshot" as const,
    messageId: "msg-123",
    snapshot: {
      messageId: "msg-123",
      trackedFileBackups: {},
      timestamp: "2026-02-18T15:09:10.006Z",
    },
    isSnapshotUpdate: false,
  };

  it("accepts a valid record", () => {
    const result = FileHistorySnapshotRecordSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("file-history-snapshot");
      expect(result.data.messageId).toBe("msg-123");
      expect(result.data.isSnapshotUpdate).toBe(false);
    }
  });

  it("accepts with populated trackedFileBackups", () => {
    const result = FileHistorySnapshotRecordSchema.safeParse({
      ...valid,
      snapshot: {
        ...valid.snapshot,
        trackedFileBackups: { "/path/to/file": { content: "..." } },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing snapshot", () => {
    const { snapshot: _, ...rest } = valid;
    const result = FileHistorySnapshotRecordSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects wrong type for isSnapshotUpdate", () => {
    const result = FileHistorySnapshotRecordSchema.safeParse({
      ...valid,
      isSnapshotUpdate: "no",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing messageId", () => {
    const { messageId: _, ...rest } = valid;
    const result = FileHistorySnapshotRecordSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ============================================================
// UserRecordSchema
// ============================================================

describe("UserRecordSchema", () => {
  const validPrompt = {
    ...makeCommonFields(),
    type: "user" as const,
    message: { role: "user" as const, content: "Hello world" },
  };

  const validToolResult = {
    ...makeCommonFields({ parentUuid: "parent-123" }),
    type: "user" as const,
    message: {
      role: "user" as const,
      content: [
        {
          type: "tool_result" as const,
          tool_use_id: "toolu_123",
          content: "file contents",
          is_error: false,
        },
      ],
    },
    toolUseResult: {
      status: "completed",
      agentId: "a748733",
    },
  };

  it("accepts a valid human prompt", () => {
    const result = UserRecordSchema.safeParse(validPrompt);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("user");
      expect(result.data.message.content).toBe("Hello world");
    }
  });

  it("accepts a valid tool result", () => {
    const result = UserRecordSchema.safeParse(validToolResult);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.data.message.content)).toBe(true);
    }
  });

  it("accepts isMeta field", () => {
    const result = UserRecordSchema.safeParse({ ...validPrompt, isMeta: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isMeta).toBe(true);
  });

  it("accepts optional toolUseResult", () => {
    const result = UserRecordSchema.safeParse(validToolResult);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolUseResult?.agentId).toBe("a748733");
    }
  });

  it("rejects missing message", () => {
    const { message: _, ...rest } = validPrompt;
    const result = UserRecordSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects wrong role", () => {
    const result = UserRecordSchema.safeParse({
      ...validPrompt,
      message: { role: "assistant", content: "hi" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing uuid (common field)", () => {
    const { uuid: _, ...rest } = validPrompt;
    const result = UserRecordSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ============================================================
// AssistantRecordSchema
// ============================================================

describe("AssistantRecordSchema", () => {
  const valid = makeAssistantRecord();

  it("accepts a valid record", () => {
    const result = AssistantRecordSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("assistant");
      expect(result.data.message.model).toBe("claude-opus-4-6");
      expect(result.data.message.id).toBe("msg_015kDst");
    }
  });

  it("accepts with tool_use content block", () => {
    const result = AssistantRecordSchema.safeParse(
      makeAssistantRecord({
        message: {
          ...valid.message,
          content: [
            {
              type: "tool_use",
              id: "toolu_012",
              name: "Read",
              input: { file_path: "/test" },
            },
          ],
        },
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts isApiErrorMessage flag", () => {
    const result = AssistantRecordSchema.safeParse({
      ...valid,
      isApiErrorMessage: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isApiErrorMessage).toBe(true);
  });

  it("rejects missing message.id", () => {
    const { id: _, ...msgRest } = valid.message;
    const result = AssistantRecordSchema.safeParse({
      ...valid,
      message: msgRest,
    });
    expect(result.success).toBe(false);
  });

  it("rejects wrong type for usage.input_tokens", () => {
    const result = AssistantRecordSchema.safeParse({
      ...valid,
      message: {
        ...valid.message,
        usage: { input_tokens: "100", output_tokens: 200 },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing usage entirely", () => {
    const { usage: _, ...msgRest } = valid.message;
    const result = AssistantRecordSchema.safeParse({
      ...valid,
      message: msgRest,
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// SystemRecordSchema
// ============================================================

describe("SystemRecordSchema", () => {
  it("accepts a valid system record with subtype", () => {
    const result = SystemRecordSchema.safeParse({
      type: "system",
      subtype: "turn_duration",
      parentUuid: "uuid-123",
      durationMs: 5000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("system");
  });

  it("accepts api_error subtype", () => {
    const result = SystemRecordSchema.safeParse({
      type: "system",
      subtype: "api_error",
      error: "rate limit",
      retryInMs: 1000,
      retryAttempt: 1,
      maxRetries: 3,
    });
    expect(result.success).toBe(true);
  });

  it("accepts local_command subtype", () => {
    const result = SystemRecordSchema.safeParse({
      type: "system",
      subtype: "local_command",
      content: "<command>/config</command>",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing subtype", () => {
    const result = SystemRecordSchema.safeParse({ type: "system" });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// ProgressRecordSchema
// ============================================================

describe("ProgressRecordSchema", () => {
  it("accepts agent_progress", () => {
    const result = ProgressRecordSchema.safeParse({
      type: "progress",
      data: {
        type: "agent_progress",
        agentId: "abc",
        prompt: "test",
        parentToolUseID: "toolu_1",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("progress");
  });

  it("accepts bash_progress", () => {
    const result = ProgressRecordSchema.safeParse({
      type: "progress",
      data: {
        type: "bash_progress",
        output: "building...",
        elapsedTimeSeconds: 3.5,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts hook_progress", () => {
    const result = ProgressRecordSchema.safeParse({
      type: "progress",
      data: {
        type: "hook_progress",
        hookEvent: "PostToolUse",
        hookName: "lint",
        command: "eslint .",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing data", () => {
    const result = ProgressRecordSchema.safeParse({ type: "progress" });
    expect(result.success).toBe(false);
  });

  it("rejects data missing type", () => {
    const result = ProgressRecordSchema.safeParse({
      type: "progress",
      data: { output: "hello" },
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// QueueOperationRecordSchema
// ============================================================

describe("QueueOperationRecordSchema", () => {
  it("accepts enqueue with content", () => {
    const result = QueueOperationRecordSchema.safeParse({
      type: "queue-operation",
      operation: "enqueue",
      content: "queued message text",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operation).toBe("enqueue");
      expect(result.data.content).toBe("queued message text");
    }
  });

  it("accepts dequeue without content", () => {
    const result = QueueOperationRecordSchema.safeParse({
      type: "queue-operation",
      operation: "dequeue",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing operation", () => {
    const result = QueueOperationRecordSchema.safeParse({
      type: "queue-operation",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// RawRecordSchema (top-level discrimination)
// ============================================================

describe("RawRecordSchema", () => {
  it("discriminates file-history-snapshot", () => {
    const result = RawRecordSchema.safeParse({
      type: "file-history-snapshot",
      messageId: "msg-1",
      snapshot: {
        messageId: "msg-1",
        trackedFileBackups: {},
        timestamp: "2026-01-01T00:00:00Z",
      },
      isSnapshotUpdate: false,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("file-history-snapshot");
  });

  it("discriminates user", () => {
    const result = RawRecordSchema.safeParse({
      ...makeCommonFields(),
      type: "user",
      message: { role: "user", content: "Hello" },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("user");
  });

  it("discriminates assistant", () => {
    const result = RawRecordSchema.safeParse(makeAssistantRecord());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("assistant");
  });

  it("discriminates system", () => {
    const result = RawRecordSchema.safeParse({
      type: "system",
      subtype: "turn_duration",
      parentUuid: "uuid-1",
      durationMs: 1000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("system");
  });

  it("discriminates progress", () => {
    const result = RawRecordSchema.safeParse({
      type: "progress",
      data: {
        type: "bash_progress",
        output: "hello",
        elapsedTimeSeconds: 1.5,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("progress");
  });

  it("discriminates queue-operation", () => {
    const result = RawRecordSchema.safeParse({
      type: "queue-operation",
      operation: "enqueue",
      content: "test",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("queue-operation");
  });

  it("rejects unknown type", () => {
    const result = RawRecordSchema.safeParse({
      type: "unknown-thing",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing type field entirely", () => {
    const result = RawRecordSchema.safeParse({ data: "hello" });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// ParsedMessageSchema (output discrimination)
// ============================================================

describe("ParsedMessageSchema", () => {
  it("discriminates on kind field", () => {
    const result = ParsedMessageSchema.safeParse({
      kind: "malformed",
      raw: "bad line",
      error: "invalid JSON",
      lineIndex: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe("malformed");
  });

  it("rejects unknown kind", () => {
    const result = ParsedMessageSchema.safeParse({
      kind: "unknown-kind",
      lineIndex: 0,
    });
    expect(result.success).toBe(false);
  });
});
