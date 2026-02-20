import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseLine } from "../parse-line";
import { parseFullSession } from "../parse-full-session";
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
  toLine,
} from "./helpers";

const fixturePath = join(import.meta.dir, "fixtures", "minimal-session.jsonl");
const fixtureContent = readFileSync(fixturePath, "utf-8");

// ============================================================
// Unit 2: Tracer Bullet — Minimal End-to-End
// ============================================================

describe("parseLine — minimal session lines", () => {
  const lines = fixtureContent.split("\n").filter((l) => l.trim() !== "");

  it("parses all 4 lines with correct kind values", () => {
    const messages = lines.map((line, i) => parseLine(line, i));
    expect(messages).toHaveLength(4);
    expect(messages[0]!.kind).toBe("file-history-snapshot");
    expect(messages[1]!.kind).toBe("user-prompt");
    expect(messages[2]!.kind).toBe("assistant-block");
    expect(messages[3]!.kind).toBe("system-turn-duration");
  });

  it("returns null for empty string", () => {
    expect(parseLine("", 0)).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseLine("   \t  ", 0)).toBeNull();
  });

  it("returns MalformedRecord for invalid JSON", () => {
    const result = parseLine("{bad json}", 5);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("malformed");
    if (result!.kind === "malformed") {
      expect(result!.error).toContain("Invalid JSON");
      expect(result!.lineIndex).toBe(5);
    }
  });

  it("returns MalformedRecord for valid JSON with missing required fields", () => {
    const result = parseLine(JSON.stringify({ type: "user" }), 0);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("malformed");
  });

  it("parseLine never throws", () => {
    const inputs = ["", "   ", "{}", "null", "123", '"string"', "{bad", "[]"];
    for (const input of inputs) {
      expect(() => parseLine(input, 0)).not.toThrow();
    }
  });
});

describe("parseLine — builder helpers produce valid records", () => {
  it("parses file-history-snapshot from helper", () => {
    const msg = parseLine(toLine(makeFileHistorySnapshot()), 0);
    expect(msg!.kind).toBe("file-history-snapshot");
  });

  it("parses user prompt from helper", () => {
    const msg = parseLine(toLine(makeUserPrompt("test prompt")), 1);
    expect(msg!.kind).toBe("user-prompt");
    if (msg!.kind === "user-prompt") {
      expect(msg!.text).toBe("test prompt");
    }
  });

  it("parses assistant text block from helper", () => {
    const msg = parseLine(toLine(makeAssistantRecord(makeTextBlock("hello"))), 2);
    expect(msg!.kind).toBe("assistant-block");
    if (msg!.kind === "assistant-block") {
      expect(msg!.contentBlock.type).toBe("text");
      expect(msg!.messageId).toBe("msg-resp-001");
    }
  });

  it("parses turn duration from helper", () => {
    const msg = parseLine(toLine(makeTurnDuration("uuid-asst-001", 500)), 3);
    expect(msg!.kind).toBe("system-turn-duration");
    if (msg!.kind === "system-turn-duration") {
      expect(msg!.durationMs).toBe(500);
      expect(msg!.parentUuid).toBe("uuid-asst-001");
    }
  });
});

describe("parseFullSession — minimal session", () => {
  const session = parseFullSession(fixtureContent);

  it("includes all 4 parsed messages", () => {
    expect(session.messages).toHaveLength(4);
  });

  it("constructs exactly 1 turn with correct prompt text and durationMs", () => {
    expect(session.turns).toHaveLength(1);
    const turn = session.turns[0];
    expect(turn.promptText).toBe("Hello, what is 2+2?");
    expect(turn.durationMs).toBe(994);
    expect(turn.turnIndex).toBe(0);
    expect(turn.promptUuid).toBe("uuid-user-001");
    expect(turn.isMeta).toBe(false);
  });

  it("reconstitutes 1 response with 1 text block and correct messageId", () => {
    expect(session.responses).toHaveLength(1);
    const response = session.responses[0];
    expect(response.messageId).toBe("msg-resp-001");
    expect(response.model).toBe("claude-sonnet-4-20250514");
    expect(response.blocks).toHaveLength(1);
    expect(response.blocks[0].type).toBe("text");
    expect(response.turnIndex).toBe(0);
    expect(response.isSynthetic).toBe(false);
  });

  it("computes basic token totals (inputTokens: 10, outputTokens: 20)", () => {
    expect(session.totals.inputTokens).toBe(10);
    expect(session.totals.outputTokens).toBe(20);
    expect(session.totals.totalTokens).toBe(30);
    expect(session.totals.cacheCreationInputTokens).toBe(0);
    expect(session.totals.cacheReadInputTokens).toBe(0);
  });

  it("sets responseCount on the turn", () => {
    expect(session.turns[0].responseCount).toBe(1);
  });

  it("returns empty enrichments for unimplemented features", () => {
    expect(session.toolCalls).toEqual([]);
    expect(session.toolStats).toEqual([]);
    expect(session.subagents).toEqual([]);
    expect(session.contextSnapshots).toEqual([]);
  });
});

describe("parseFullSession — edge cases", () => {
  it("handles empty string → empty session", () => {
    const session = parseFullSession("");
    expect(session.messages).toHaveLength(0);
    expect(session.turns).toHaveLength(0);
    expect(session.responses).toHaveLength(0);
  });

  it("filters blank lines", () => {
    const content = "\n\n" + fixtureContent + "\n\n";
    const session = parseFullSession(content);
    // blank lines become null and are filtered
    expect(session.messages).toHaveLength(4);
  });
});

// ============================================================
// Unit 3: parseLine — User Tool Result
// ============================================================

describe("parseLine — user tool result (happy path)", () => {
  const record = makeUserToolResult([
    makeToolResultItem("toolu_001", "file contents here"),
  ]);
  const msg = parseLine(toLine(record), 5);

  it("returns kind user-tool-result", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("user-tool-result");
  });

  it("extracts common fields", () => {
    if (msg!.kind !== "user-tool-result") throw new Error("wrong kind");
    expect(msg!.uuid).toBe("uuid-toolresult-001");
    expect(msg!.parentUuid).toBe("uuid-asst-001");
    expect(msg!.sessionId).toBe("session-001");
    expect(msg!.timestamp).toBe("2026-02-18T15:09:10.006Z");
  });

  it("extracts results with mapped field names", () => {
    if (msg!.kind !== "user-tool-result") throw new Error("wrong kind");
    expect(msg!.results).toHaveLength(1);
    expect(msg!.results[0].toolUseId).toBe("toolu_001");
    expect(msg!.results[0].content).toBe("file contents here");
    expect(msg!.results[0].isError).toBe(false);
  });

  it("sets toolUseResult to null when absent", () => {
    if (msg!.kind !== "user-tool-result") throw new Error("wrong kind");
    expect(msg!.toolUseResult).toBeNull();
  });

  it("preserves lineIndex", () => {
    if (msg!.kind !== "user-tool-result") throw new Error("wrong kind");
    expect(msg!.lineIndex).toBe(5);
  });
});

describe("parseLine — user tool result with is_error: true", () => {
  const record = makeUserToolResult([
    makeToolResultItem("toolu_err", "Error: file not found", true),
  ]);
  const msg = parseLine(toLine(record), 0);

  it("maps is_error to isError", () => {
    if (msg!.kind !== "user-tool-result") throw new Error("wrong kind");
    expect(msg!.results[0].isError).toBe(true);
    expect(msg!.results[0].content).toBe("Error: file not found");
  });
});

describe("parseLine — user tool result with toolUseResult (agentId)", () => {
  const record = makeUserToolResult(
    [makeToolResultItem("toolu_agent", "subagent completed")],
    {
      toolUseResult: {
        status: "completed",
        prompt: "Search the codebase for X",
        agentId: "a748733",
        totalDurationMs: 61098,
        totalTokens: 68154,
        totalToolUseCount: 35,
      },
    },
  );
  const msg = parseLine(toLine(record), 10);

  it("passes through toolUseResult metadata", () => {
    if (msg!.kind !== "user-tool-result") throw new Error("wrong kind");
    expect(msg!.toolUseResult).not.toBeNull();
    expect(msg!.toolUseResult!.agentId).toBe("a748733");
    expect(msg!.toolUseResult!.prompt).toBe("Search the codebase for X");
    expect(msg!.toolUseResult!.totalDurationMs).toBe(61098);
    expect(msg!.toolUseResult!.totalTokens).toBe(68154);
    expect(msg!.toolUseResult!.totalToolUseCount).toBe(35);
    expect(msg!.toolUseResult!.status).toBe("completed");
  });
});

describe("parseLine — user tool result with multiple results", () => {
  const record = makeUserToolResult([
    makeToolResultItem("toolu_001", "result 1"),
    makeToolResultItem("toolu_002", "result 2", true),
  ]);
  const msg = parseLine(toLine(record), 0);

  it("extracts all results", () => {
    if (msg!.kind !== "user-tool-result") throw new Error("wrong kind");
    expect(msg!.results).toHaveLength(2);
    expect(msg!.results[0].toolUseId).toBe("toolu_001");
    expect(msg!.results[0].isError).toBe(false);
    expect(msg!.results[1].toolUseId).toBe("toolu_002");
    expect(msg!.results[1].isError).toBe(true);
  });
});

// ============================================================
// Unit 4: parseLine — Assistant Block Variants
// ============================================================

describe("parseLine — assistant thinking block", () => {
  const thinking = makeThinkingBlock("Let me think about this...", "sig-think-001");
  const record = makeAssistantRecord(thinking, {
    uuid: "uuid-asst-think",
    parentUuid: "uuid-user-001",
  });
  // Override message id for this test
  (record.message as Record<string, unknown>).id = "msg-think-001";
  const msg = parseLine(toLine(record), 7);

  it("returns kind assistant-block", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("assistant-block");
  });

  it("extracts thinking content block with type, thinking text, and signature", () => {
    if (msg!.kind !== "assistant-block") throw new Error("wrong kind");
    expect(msg!.contentBlock.type).toBe("thinking");
    if (msg!.contentBlock.type === "thinking") {
      expect(msg!.contentBlock.thinking).toBe("Let me think about this...");
      expect(msg!.contentBlock.signature).toBe("sig-think-001");
    }
  });

  it("preserves common fields and metadata", () => {
    if (msg!.kind !== "assistant-block") throw new Error("wrong kind");
    expect(msg!.uuid).toBe("uuid-asst-think");
    expect(msg!.messageId).toBe("msg-think-001");
    expect(msg!.model).toBe("claude-sonnet-4-20250514");
    expect(msg!.isSynthetic).toBe(false);
    expect(msg!.lineIndex).toBe(7);
  });

  it("includes usage data", () => {
    if (msg!.kind !== "assistant-block") throw new Error("wrong kind");
    expect(msg!.usage.input_tokens).toBe(10);
    expect(msg!.usage.output_tokens).toBe(20);
  });
});

describe("parseLine — assistant tool_use block", () => {
  const toolUse = makeToolUseBlock("Read", { file_path: "/src/index.ts" }, "toolu_read_001");
  const record = makeAssistantRecord(toolUse, {
    uuid: "uuid-asst-tool",
    parentUuid: "uuid-user-001",
  });
  (record.message as Record<string, unknown>).id = "msg-tool-001";
  const msg = parseLine(toLine(record), 8);

  it("returns kind assistant-block", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("assistant-block");
  });

  it("extracts tool_use content block with id, name, and input", () => {
    if (msg!.kind !== "assistant-block") throw new Error("wrong kind");
    expect(msg!.contentBlock.type).toBe("tool_use");
    if (msg!.contentBlock.type === "tool_use") {
      expect(msg!.contentBlock.id).toBe("toolu_read_001");
      expect(msg!.contentBlock.name).toBe("Read");
      expect(msg!.contentBlock.input).toEqual({ file_path: "/src/index.ts" });
    }
  });

  it("preserves common fields and metadata", () => {
    if (msg!.kind !== "assistant-block") throw new Error("wrong kind");
    expect(msg!.uuid).toBe("uuid-asst-tool");
    expect(msg!.messageId).toBe("msg-tool-001");
    expect(msg!.isSynthetic).toBe(false);
    expect(msg!.lineIndex).toBe(8);
  });
});

describe("parseLine — synthetic assistant record (isApiErrorMessage: true)", () => {
  const textBlock = makeTextBlock("An error occurred while processing your request.");
  const record = makeAssistantRecord(textBlock, {
    uuid: "uuid-asst-synthetic",
    isApiErrorMessage: true,
  });
  (record.message as Record<string, unknown>).id = "msg-synthetic-001";
  const msg = parseLine(toLine(record), 12);

  it("returns kind assistant-block", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("assistant-block");
  });

  it("sets isSynthetic to true", () => {
    if (msg!.kind !== "assistant-block") throw new Error("wrong kind");
    expect(msg!.isSynthetic).toBe(true);
  });

  it("still extracts content block normally", () => {
    if (msg!.kind !== "assistant-block") throw new Error("wrong kind");
    expect(msg!.contentBlock.type).toBe("text");
    if (msg!.contentBlock.type === "text") {
      expect(msg!.contentBlock.text).toBe("An error occurred while processing your request.");
    }
  });

  it("preserves messageId and model", () => {
    if (msg!.kind !== "assistant-block") throw new Error("wrong kind");
    expect(msg!.messageId).toBe("msg-synthetic-001");
    expect(msg!.model).toBe("claude-sonnet-4-20250514");
  });
});

describe("parseLine — assistant with isApiErrorMessage absent defaults to false", () => {
  const textBlock = makeTextBlock("Normal response");
  const record = makeAssistantRecord(textBlock);
  const msg = parseLine(toLine(record), 0);

  it("defaults isSynthetic to false when isApiErrorMessage is not set", () => {
    if (msg!.kind !== "assistant-block") throw new Error("wrong kind");
    expect(msg!.isSynthetic).toBe(false);
  });
});

describe("parseLine — assistant with empty content array", () => {
  const record = {
    ...makeAssistantRecord(makeTextBlock("placeholder")),
  };
  // Override content to be empty array
  (record.message as Record<string, unknown>).content = [];
  const msg = parseLine(toLine(record), 0);

  it("returns malformed when content array is empty", () => {
    expect(msg).not.toBeNull();
    // Zod validation should reject empty content array since min 1 item expected,
    // or our code handles it as malformed
    expect(msg!.kind).toBe("malformed");
  });
});

// ============================================================
// Unit 5: parseLine — System Subtypes (api_error, local_command)
// ============================================================

describe("parseLine — system api_error", () => {
  const record = makeSystemApiError("overloaded_error", {
    retryInMs: 10000,
    retryAttempt: 2,
    maxRetries: 5,
  });
  const msg = parseLine(toLine(record), 15);

  it("returns kind system-api-error", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("system-api-error");
  });

  it("extracts error string", () => {
    if (msg!.kind !== "system-api-error") throw new Error("wrong kind");
    expect(msg!.error).toBe("overloaded_error");
  });

  it("extracts retryInMs", () => {
    if (msg!.kind !== "system-api-error") throw new Error("wrong kind");
    expect(msg!.retryInMs).toBe(10000);
  });

  it("extracts retryAttempt", () => {
    if (msg!.kind !== "system-api-error") throw new Error("wrong kind");
    expect(msg!.retryAttempt).toBe(2);
  });

  it("extracts maxRetries", () => {
    if (msg!.kind !== "system-api-error") throw new Error("wrong kind");
    expect(msg!.maxRetries).toBe(5);
  });

  it("preserves lineIndex", () => {
    if (msg!.kind !== "system-api-error") throw new Error("wrong kind");
    expect(msg!.lineIndex).toBe(15);
  });
});

describe("parseLine — system api_error with default helper values", () => {
  const record = makeSystemApiError("rate_limit_error");
  const msg = parseLine(toLine(record), 0);

  it("uses helper defaults for retry fields", () => {
    if (msg!.kind !== "system-api-error") throw new Error("wrong kind");
    expect(msg!.error).toBe("rate_limit_error");
    expect(msg!.retryInMs).toBe(5000);
    expect(msg!.retryAttempt).toBe(1);
    expect(msg!.maxRetries).toBe(3);
  });
});

describe("parseLine — system api_error missing required field → MalformedRecord", () => {
  const record = {
    type: "system",
    subtype: "api_error",
    error: "some_error",
    // missing retryInMs, retryAttempt, maxRetries
  };
  const msg = parseLine(toLine(record), 0);

  it("returns malformed when required fields are missing", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — system local_command", () => {
  const record = makeSystemLocalCommand("git status");
  const msg = parseLine(toLine(record), 20);

  it("returns kind system-local-command", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("system-local-command");
  });

  it("extracts content", () => {
    if (msg!.kind !== "system-local-command") throw new Error("wrong kind");
    expect(msg!.content).toBe("git status");
  });

  it("preserves lineIndex", () => {
    if (msg!.kind !== "system-local-command") throw new Error("wrong kind");
    expect(msg!.lineIndex).toBe(20);
  });
});

describe("parseLine — system local_command missing content → MalformedRecord", () => {
  const record = {
    type: "system",
    subtype: "local_command",
    // missing content
  };
  const msg = parseLine(toLine(record), 0);

  it("returns malformed when content is missing", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — unknown system subtype → MalformedRecord", () => {
  const record = {
    type: "system",
    subtype: "unknown_subtype_xyz",
    someField: "value",
  };
  const msg = parseLine(toLine(record), 25);

  it("returns malformed for unknown subtype", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });

  it("includes subtype name in error message", () => {
    if (msg!.kind !== "malformed") throw new Error("wrong kind");
    expect(msg!.error).toContain("unknown_subtype_xyz");
  });

  it("preserves lineIndex", () => {
    if (msg!.kind !== "malformed") throw new Error("wrong kind");
    expect(msg!.lineIndex).toBe(25);
  });
});
