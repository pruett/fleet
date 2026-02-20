/**
 * Fixture builder functions for creating raw JSONL records and content blocks.
 * Used by tests to programmatically construct valid (and intentionally invalid) test data.
 */

export function makeCommonFields(overrides: Record<string, unknown> = {}) {
  return {
    uuid: "uuid-user-001",
    parentUuid: null as string | null,
    sessionId: "session-001",
    timestamp: "2026-02-18T15:09:10.006Z",
    ...overrides,
  };
}

export function makeFileHistorySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    type: "file-history-snapshot" as const,
    messageId: "msg-001",
    snapshot: {
      messageId: "msg-001",
      trackedFileBackups: {},
      timestamp: "2026-02-18T15:09:10.000Z",
    },
    isSnapshotUpdate: false,
    ...overrides,
  };
}

export function makeUserPrompt(text: string, overrides: Record<string, unknown> = {}) {
  return {
    ...makeCommonFields(),
    type: "user" as const,
    message: { role: "user" as const, content: text },
    ...overrides,
  };
}

export function makeTextBlock(text: string) {
  return { type: "text" as const, text };
}

export function makeThinkingBlock(thinking: string, signature = "sig-001") {
  return { type: "thinking" as const, thinking, signature };
}

export function makeToolUseBlock(name: string, input: Record<string, unknown>, id = "toolu_001") {
  return { type: "tool_use" as const, id, name, input };
}

export function makeAssistantRecord(
  contentBlock: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...makeCommonFields({ uuid: "uuid-asst-001", parentUuid: "uuid-user-001" }),
    type: "assistant" as const,
    message: {
      model: "claude-sonnet-4-20250514",
      id: "msg-resp-001",
      type: "message" as const,
      role: "assistant" as const,
      content: [contentBlock],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    },
    ...overrides,
  };
}

export function makeTurnDuration(parentUuid: string, durationMs: number) {
  return {
    type: "system" as const,
    subtype: "turn_duration" as const,
    parentUuid,
    durationMs,
  };
}

export function makeToolResultItem(
  toolUseId: string,
  content: unknown = "tool output",
  isError = false,
) {
  return {
    type: "tool_result" as const,
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  };
}

export function makeUserToolResult(
  results: Array<{ type: "tool_result"; tool_use_id: string; content: unknown; is_error: boolean }>,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...makeCommonFields({ uuid: "uuid-toolresult-001", parentUuid: "uuid-asst-001" }),
    type: "user" as const,
    message: { role: "user" as const, content: results },
    ...overrides,
  };
}

export function makeSystemApiError(
  error: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: "system" as const,
    subtype: "api_error" as const,
    error,
    retryInMs: 5000,
    retryAttempt: 1,
    maxRetries: 3,
    ...overrides,
  };
}

export function makeSystemLocalCommand(
  content: string,
) {
  return {
    type: "system" as const,
    subtype: "local_command" as const,
    content,
  };
}

/** Serialize a record to a JSONL line */
export function toLine(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}
