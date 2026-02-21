import { describe, expect, it } from "bun:test";
import { parseLine } from "../parse-line";
import {
  makeFileHistorySnapshot,
  makeUserPrompt,
  makeUserToolResult,
  makeToolResultItem,
  makeAssistantRecord,
  makeTextBlock,
  makeThinkingBlock,
  makeToolUseBlock,
  makeTurnDuration,
  makeSystemApiError,
  makeSystemLocalCommand,
  makeProgressAgent,
  makeProgressBash,
  makeProgressHook,
  makeQueueOperation,
  toLine,
} from "./helpers";

// ============================================================
// Unit 16: parseLine — Comprehensive Unit Tests
// One describe block per message kind (12 kinds)
// ============================================================

describe("parseLine — file-history-snapshot", () => {
  it("happy path: extracts all fields", () => {
    const record = makeFileHistorySnapshot({
      messageId: "msg-fhs-100",
      snapshot: {
        messageId: "msg-fhs-100",
        trackedFileBackups: { "src/index.ts": { hash: "abc123" } },
        timestamp: "2026-02-18T10:00:00.000Z",
      },
      isSnapshotUpdate: true,
    });
    const msg = parseLine(toLine(record), 7);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("file-history-snapshot");
    if (msg!.kind !== "file-history-snapshot") return;
    expect(msg.messageId).toBe("msg-fhs-100");
    expect(msg.snapshot.messageId).toBe("msg-fhs-100");
    expect(msg.snapshot.trackedFileBackups).toEqual({ "src/index.ts": { hash: "abc123" } });
    expect(msg.snapshot.timestamp).toBe("2026-02-18T10:00:00.000Z");
    expect(msg.isSnapshotUpdate).toBe(true);
    expect(msg.lineIndex).toBe(7);
  });

  it("minimal valid input: empty trackedFileBackups", () => {
    const record = makeFileHistorySnapshot();
    const msg = parseLine(toLine(record), 0);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("file-history-snapshot");
    if (msg!.kind !== "file-history-snapshot") return;
    expect(msg.snapshot.trackedFileBackups).toEqual({});
    expect(msg.isSnapshotUpdate).toBe(false);
  });

  it("missing messageId → malformed", () => {
    const record = makeFileHistorySnapshot();
    delete (record as Record<string, unknown>).messageId;
    const msg = parseLine(toLine(record), 0);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });

  it("missing snapshot → malformed", () => {
    const record = makeFileHistorySnapshot();
    delete (record as Record<string, unknown>).snapshot;
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("missing isSnapshotUpdate → malformed", () => {
    const record = makeFileHistorySnapshot();
    delete (record as Record<string, unknown>).isSnapshotUpdate;
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — user-prompt", () => {
  it("happy path: extracts all fields", () => {
    const record = makeUserPrompt("Hello, Claude!", {
      uuid: "uuid-u-200",
      parentUuid: "uuid-parent-200",
      sessionId: "sess-200",
      timestamp: "2026-02-18T12:00:00.000Z",
      isMeta: true,
    });
    const msg = parseLine(toLine(record), 3);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("user-prompt");
    if (msg!.kind !== "user-prompt") return;
    expect(msg.uuid).toBe("uuid-u-200");
    expect(msg.parentUuid).toBe("uuid-parent-200");
    expect(msg.sessionId).toBe("sess-200");
    expect(msg.timestamp).toBe("2026-02-18T12:00:00.000Z");
    expect(msg.text).toBe("Hello, Claude!");
    expect(msg.isMeta).toBe(true);
    expect(msg.lineIndex).toBe(3);
  });

  it("missing isMeta defaults to false", () => {
    const record = makeUserPrompt("test");
    // isMeta is not set on the helper by default
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("user-prompt");
    if (msg!.kind !== "user-prompt") return;
    expect(msg.isMeta).toBe(false);
  });

  it("parentUuid can be null", () => {
    const record = makeUserPrompt("test", { parentUuid: null });
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("user-prompt");
    if (msg!.kind !== "user-prompt") return;
    expect(msg.parentUuid).toBeNull();
  });

  it("minimal valid input: empty string text", () => {
    const record = makeUserPrompt("");
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("user-prompt");
    if (msg!.kind !== "user-prompt") return;
    expect(msg.text).toBe("");
  });

  it("missing uuid → malformed", () => {
    const record = makeUserPrompt("test");
    delete (record as Record<string, unknown>).uuid;
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("missing sessionId → malformed", () => {
    const record = makeUserPrompt("test");
    delete (record as Record<string, unknown>).sessionId;
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — user-tool-result", () => {
  it("happy path: extracts all fields", () => {
    const results = [
      makeToolResultItem("toolu_300", "file contents here", false),
      makeToolResultItem("toolu_301", "error output", true),
    ];
    const record = makeUserToolResult(results, {
      uuid: "uuid-tr-300",
      parentUuid: "uuid-asst-300",
      sessionId: "sess-300",
      timestamp: "2026-02-18T13:00:00.000Z",
      toolUseResult: {
        status: "completed",
        agentId: "agent-300",
        totalDurationMs: 1500,
        totalTokens: 500,
        totalToolUseCount: 3,
      },
    });
    const msg = parseLine(toLine(record), 5);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("user-tool-result");
    if (msg!.kind !== "user-tool-result") return;
    expect(msg.uuid).toBe("uuid-tr-300");
    expect(msg.parentUuid).toBe("uuid-asst-300");
    expect(msg.sessionId).toBe("sess-300");
    expect(msg.timestamp).toBe("2026-02-18T13:00:00.000Z");
    expect(msg.results).toHaveLength(2);
    expect(msg.results[0].toolUseId).toBe("toolu_300");
    expect(msg.results[0].content).toBe("file contents here");
    expect(msg.results[0].isError).toBe(false);
    expect(msg.results[1].toolUseId).toBe("toolu_301");
    expect(msg.results[1].content).toBe("error output");
    expect(msg.results[1].isError).toBe(true);
    expect(msg.toolUseResult).not.toBeNull();
    expect(msg.toolUseResult!.agentId).toBe("agent-300");
    expect(msg.toolUseResult!.totalDurationMs).toBe(1500);
    expect(msg.toolUseResult!.totalTokens).toBe(500);
    expect(msg.toolUseResult!.totalToolUseCount).toBe(3);
    expect(msg.lineIndex).toBe(5);
  });

  it("missing toolUseResult defaults to null", () => {
    const results = [makeToolResultItem("toolu_310", "output")];
    const record = makeUserToolResult(results);
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("user-tool-result");
    if (msg!.kind !== "user-tool-result") return;
    expect(msg.toolUseResult).toBeNull();
  });

  it("missing is_error defaults to false", () => {
    const item = { type: "tool_result" as const, tool_use_id: "toolu_320", content: "ok" };
    const record = makeUserToolResult([item as ReturnType<typeof makeToolResultItem>]);
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("user-tool-result");
    if (msg!.kind !== "user-tool-result") return;
    expect(msg.results[0].isError).toBe(false);
  });

  it("minimal valid input: single result with minimal fields", () => {
    const results = [makeToolResultItem("toolu_330", "")];
    const record = makeUserToolResult(results);
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("user-tool-result");
    if (msg!.kind !== "user-tool-result") return;
    expect(msg.results).toHaveLength(1);
    expect(msg.results[0].content).toBe("");
  });

  it("content can be a complex object", () => {
    const results = [makeToolResultItem("toolu_340", { nested: { data: [1, 2, 3] } })];
    const record = makeUserToolResult(results);
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("user-tool-result");
    if (msg!.kind !== "user-tool-result") return;
    expect(msg.results[0].content).toEqual({ nested: { data: [1, 2, 3] } });
  });
});

describe("parseLine — assistant-block (text)", () => {
  it("happy path: extracts all fields for text block", () => {
    const record = makeAssistantRecord(makeTextBlock("Hello! How can I help?"), {
      uuid: "uuid-a-400",
      parentUuid: "uuid-u-400",
      sessionId: "sess-400",
      timestamp: "2026-02-18T14:00:00.000Z",
      message: {
        model: "claude-opus-4-20250514",
        id: "msg-400",
        stop_reason: "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      },
    });
    const msg = parseLine(toLine(record), 2);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind !== "assistant-block") return;
    expect(msg.uuid).toBe("uuid-a-400");
    expect(msg.parentUuid).toBe("uuid-u-400");
    expect(msg.sessionId).toBe("sess-400");
    expect(msg.timestamp).toBe("2026-02-18T14:00:00.000Z");
    expect(msg.messageId).toBe("msg-400");
    expect(msg.model).toBe("claude-opus-4-20250514");
    expect(msg.contentBlock.type).toBe("text");
    expect((msg.contentBlock as Extract<typeof msg.contentBlock, { type: "text" }>).text).toBe("Hello! How can I help?");
    expect(msg.usage.input_tokens).toBe(100);
    expect(msg.usage.output_tokens).toBe(50);
    expect(msg.usage.cache_creation_input_tokens).toBe(10);
    expect(msg.usage.cache_read_input_tokens).toBe(5);
    expect(msg.isSynthetic).toBe(false);
    expect(msg.lineIndex).toBe(2);
  });

  it("missing cache tokens default to undefined", () => {
    const record = makeAssistantRecord(makeTextBlock("test"));
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind !== "assistant-block") return;
    expect(msg.usage.cache_creation_input_tokens).toBeUndefined();
    expect(msg.usage.cache_read_input_tokens).toBeUndefined();
  });

  it("missing isApiErrorMessage defaults to isSynthetic: false", () => {
    const record = makeAssistantRecord(makeTextBlock("test"));
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind !== "assistant-block") return;
    expect(msg.isSynthetic).toBe(false);
  });

  it("isApiErrorMessage: true → isSynthetic: true", () => {
    const record = makeAssistantRecord(makeTextBlock("error text"), {
      isApiErrorMessage: true,
    });
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind !== "assistant-block") return;
    expect(msg.isSynthetic).toBe(true);
  });

  it("empty content array → malformed (rejected by schema)", () => {
    const record = makeAssistantRecord(makeTextBlock("test"), {
      message: {
        id: "msg-empty",
        content: [],
      },
    });
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — assistant-block (thinking)", () => {
  it("happy path: extracts thinking block fields", () => {
    const record = makeAssistantRecord(makeThinkingBlock("Let me think about this...", "sig-think-500"));
    const msg = parseLine(toLine(record), 4);
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind !== "assistant-block") return;
    expect(msg.contentBlock.type).toBe("thinking");
    const thinkingBlock = msg.contentBlock as Extract<typeof msg.contentBlock, { type: "thinking" }>;
    expect(thinkingBlock.thinking).toBe("Let me think about this...");
    expect(thinkingBlock.signature).toBe("sig-think-500");
    expect(msg.lineIndex).toBe(4);
  });

  it("minimal valid input: empty thinking text", () => {
    const record = makeAssistantRecord(makeThinkingBlock("", "sig-empty"));
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind !== "assistant-block") return;
    expect(msg.contentBlock.type).toBe("thinking");
    expect((msg.contentBlock as Extract<typeof msg.contentBlock, { type: "thinking" }>).thinking).toBe("");
  });
});

describe("parseLine — assistant-block (tool_use)", () => {
  it("happy path: extracts tool_use block fields", () => {
    const record = makeAssistantRecord(
      makeToolUseBlock("Bash", { command: "ls -la" }, "toolu_600"),
    );
    const msg = parseLine(toLine(record), 6);
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind !== "assistant-block") return;
    expect(msg.contentBlock.type).toBe("tool_use");
    const toolBlock = msg.contentBlock as Extract<typeof msg.contentBlock, { type: "tool_use" }>;
    expect(toolBlock.id).toBe("toolu_600");
    expect(toolBlock.name).toBe("Bash");
    expect(toolBlock.input).toEqual({ command: "ls -la" });
    expect(msg.lineIndex).toBe(6);
  });

  it("minimal valid input: empty input object", () => {
    const record = makeAssistantRecord(makeToolUseBlock("Read", {}, "toolu_610"));
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind !== "assistant-block") return;
    expect(msg.contentBlock.type).toBe("tool_use");
    expect((msg.contentBlock as Extract<typeof msg.contentBlock, { type: "tool_use" }>).input).toEqual({});
  });

  it("complex nested input preserved", () => {
    const complexInput = {
      file_path: "/src/index.ts",
      options: { recursive: true, depth: 3 },
      filters: ["*.ts", "*.tsx"],
    };
    const record = makeAssistantRecord(makeToolUseBlock("Glob", complexInput, "toolu_620"));
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind !== "assistant-block") return;
    expect(msg.contentBlock.type).toBe("tool_use");
    expect((msg.contentBlock as Extract<typeof msg.contentBlock, { type: "tool_use" }>).input).toEqual(complexInput);
  });
});

describe("parseLine — system-turn-duration", () => {
  it("happy path: extracts all fields", () => {
    const record = makeTurnDuration("uuid-parent-700", 4567);
    const msg = parseLine(toLine(record), 10);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("system-turn-duration");
    if (msg!.kind !== "system-turn-duration") return;
    expect(msg.parentUuid).toBe("uuid-parent-700");
    expect(msg.durationMs).toBe(4567);
    expect(msg.lineIndex).toBe(10);
  });

  it("minimal valid input: durationMs of 0", () => {
    const record = makeTurnDuration("uuid-min", 0);
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("system-turn-duration");
    if (msg!.kind !== "system-turn-duration") return;
    expect(msg.durationMs).toBe(0);
  });

  it("missing parentUuid → malformed", () => {
    const record = { type: "system", subtype: "turn_duration", durationMs: 1000 };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("missing durationMs → malformed", () => {
    const record = { type: "system", subtype: "turn_duration", parentUuid: "uuid-x" };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — system-api-error", () => {
  it("happy path: extracts all fields", () => {
    const record = makeSystemApiError("Rate limit exceeded", {
      retryInMs: 10000,
      retryAttempt: 2,
      maxRetries: 5,
    });
    const msg = parseLine(toLine(record), 8);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("system-api-error");
    if (msg!.kind !== "system-api-error") return;
    expect(msg.error).toBe("Rate limit exceeded");
    expect(msg.retryInMs).toBe(10000);
    expect(msg.retryAttempt).toBe(2);
    expect(msg.maxRetries).toBe(5);
    expect(msg.lineIndex).toBe(8);
  });

  it("minimal valid input: uses helper defaults", () => {
    const record = makeSystemApiError("error");
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("system-api-error");
    if (msg!.kind !== "system-api-error") return;
    expect(msg.error).toBe("error");
    expect(msg.retryInMs).toBe(5000);
    expect(msg.retryAttempt).toBe(1);
    expect(msg.maxRetries).toBe(3);
  });

  it("missing error field → malformed", () => {
    const record = { type: "system", subtype: "api_error", retryInMs: 5000, retryAttempt: 1, maxRetries: 3 };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("missing retryInMs → malformed", () => {
    const record = { type: "system", subtype: "api_error", error: "err", retryAttempt: 1, maxRetries: 3 };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — system-local-command", () => {
  it("happy path: extracts content", () => {
    const record = makeSystemLocalCommand("npm install");
    const msg = parseLine(toLine(record), 9);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("system-local-command");
    if (msg!.kind !== "system-local-command") return;
    expect(msg.content).toBe("npm install");
    expect(msg.lineIndex).toBe(9);
  });

  it("minimal valid input: empty string content", () => {
    const record = makeSystemLocalCommand("");
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("system-local-command");
    if (msg!.kind !== "system-local-command") return;
    expect(msg.content).toBe("");
  });

  it("missing content → malformed", () => {
    const record = { type: "system", subtype: "local_command" };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("unknown system subtype → malformed with subtype name", () => {
    const record = { type: "system", subtype: "unknown_sub_xyz" };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
    if (msg!.kind === "malformed") {
      expect(msg.error).toContain("unknown_sub_xyz");
    }
  });
});

describe("parseLine — progress-agent", () => {
  it("happy path: extracts all fields", () => {
    const record = makeProgressAgent("agent-800", "Implement feature X", "toolu_parent_800");
    const msg = parseLine(toLine(record), 11);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("progress-agent");
    if (msg!.kind !== "progress-agent") return;
    expect(msg.agentId).toBe("agent-800");
    expect(msg.prompt).toBe("Implement feature X");
    expect(msg.parentToolUseID).toBe("toolu_parent_800");
    expect(msg.lineIndex).toBe(11);
  });

  it("minimal valid input: uses helper defaults for parentToolUseID", () => {
    const record = makeProgressAgent("agent-min", "do something");
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("progress-agent");
    if (msg!.kind !== "progress-agent") return;
    expect(msg.parentToolUseID).toBe("toolu_agent_001");
  });

  it("missing agentId → malformed", () => {
    const record = {
      type: "progress",
      data: { type: "agent_progress", prompt: "test", parentToolUseID: "toolu_x" },
    };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("missing prompt → malformed", () => {
    const record = {
      type: "progress",
      data: { type: "agent_progress", agentId: "a1", parentToolUseID: "toolu_x" },
    };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — progress-bash", () => {
  it("happy path: extracts all fields", () => {
    const record = makeProgressBash("total 48\ndrwxr-xr-x  12 user  staff  384 Feb 18 10:00 .", 3.7);
    const msg = parseLine(toLine(record), 12);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("progress-bash");
    if (msg!.kind !== "progress-bash") return;
    expect(msg.output).toContain("total 48");
    expect(msg.elapsedTimeSeconds).toBe(3.7);
    expect(msg.lineIndex).toBe(12);
  });

  it("minimal valid input: uses helper defaults for elapsedTimeSeconds", () => {
    const record = makeProgressBash("output");
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("progress-bash");
    if (msg!.kind !== "progress-bash") return;
    expect(msg.elapsedTimeSeconds).toBe(1.5);
  });

  it("minimal valid input: empty output string", () => {
    const record = makeProgressBash("", 0);
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("progress-bash");
    if (msg!.kind !== "progress-bash") return;
    expect(msg.output).toBe("");
    expect(msg.elapsedTimeSeconds).toBe(0);
  });

  it("missing output → malformed", () => {
    const record = {
      type: "progress",
      data: { type: "bash_progress", elapsedTimeSeconds: 1.0 },
    };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("missing elapsedTimeSeconds → malformed", () => {
    const record = {
      type: "progress",
      data: { type: "bash_progress", output: "test" },
    };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — progress-hook", () => {
  it("happy path: extracts all fields", () => {
    const record = makeProgressHook("pre-commit", "lint-check", "eslint .");
    const msg = parseLine(toLine(record), 13);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("progress-hook");
    if (msg!.kind !== "progress-hook") return;
    expect(msg.hookEvent).toBe("pre-commit");
    expect(msg.hookName).toBe("lint-check");
    expect(msg.command).toBe("eslint .");
    expect(msg.lineIndex).toBe(13);
  });

  it("minimal valid input: empty strings accepted", () => {
    const record = makeProgressHook("", "", "");
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("progress-hook");
    if (msg!.kind !== "progress-hook") return;
    expect(msg.hookEvent).toBe("");
    expect(msg.hookName).toBe("");
    expect(msg.command).toBe("");
  });

  it("missing hookEvent → malformed", () => {
    const record = {
      type: "progress",
      data: { type: "hook_progress", hookName: "test", command: "cmd" },
    };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("missing command → malformed", () => {
    const record = {
      type: "progress",
      data: { type: "hook_progress", hookEvent: "evt", hookName: "test" },
    };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("unknown progress data type → malformed with type name", () => {
    const record = {
      type: "progress",
      data: { type: "unknown_progress_xyz" },
    };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
    if (msg!.kind === "malformed") {
      expect(msg.error).toContain("unknown_progress_xyz");
    }
  });
});

describe("parseLine — queue-operation", () => {
  it("happy path: extracts all fields with content", () => {
    const record = makeQueueOperation("enqueue", "Build the dashboard component");
    const msg = parseLine(toLine(record), 14);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("queue-operation");
    if (msg!.kind !== "queue-operation") return;
    expect(msg.operation).toBe("enqueue");
    expect(msg.content).toBe("Build the dashboard component");
    expect(msg.lineIndex).toBe(14);
  });

  it("missing content defaults to undefined", () => {
    const record = makeQueueOperation("dequeue");
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("queue-operation");
    if (msg!.kind !== "queue-operation") return;
    expect(msg.operation).toBe("dequeue");
    expect(msg.content).toBeUndefined();
  });

  it("minimal valid input: empty string content", () => {
    const record = makeQueueOperation("enqueue", "");
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("queue-operation");
    if (msg!.kind !== "queue-operation") return;
    expect(msg.content).toBe("");
  });

  it("missing operation → malformed", () => {
    const record = { type: "queue-operation" };
    const msg = parseLine(toLine(record), 0);
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — malformed", () => {
  it("invalid JSON → malformed with error details", () => {
    const msg = parseLine("{not valid json}", 15);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
    if (msg!.kind !== "malformed") return;
    expect(msg.raw).toBe("{not valid json}");
    expect(msg.error).toContain("Invalid JSON");
    expect(msg.lineIndex).toBe(15);
  });

  it("valid JSON failing Zod validation → malformed with Zod error", () => {
    const msg = parseLine(JSON.stringify({ type: "user" }), 16);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
    if (msg!.kind !== "malformed") return;
    expect(msg.raw).toBe(JSON.stringify({ type: "user" }));
    expect(msg.lineIndex).toBe(16);
  });

  it("unknown record type → malformed", () => {
    const msg = parseLine(JSON.stringify({ type: "unknown_type_xyz" }), 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("empty string → null (not malformed)", () => {
    expect(parseLine("", 0)).toBeNull();
  });

  it("whitespace-only → null (not malformed)", () => {
    expect(parseLine("   \t\n  ", 0)).toBeNull();
  });

  it("JSON number → malformed", () => {
    const msg = parseLine("42", 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("JSON string → malformed", () => {
    const msg = parseLine('"hello"', 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("JSON array → malformed", () => {
    const msg = parseLine("[1, 2, 3]", 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("JSON null → malformed", () => {
    const msg = parseLine("null", 0);
    expect(msg!.kind).toBe("malformed");
  });

  it("parseLine never throws for any input", () => {
    const inputs = [
      "", "   ", "{}", "null", "123", '"string"', "{bad json", "[]",
      "undefined", "NaN", "true", "false", '{"type": 42}',
      "\x00\x01\x02", "🎉", String.raw`\n\t\r`,
    ];
    for (const input of inputs) {
      expect(() => parseLine(input, 0)).not.toThrow();
    }
  });
});
