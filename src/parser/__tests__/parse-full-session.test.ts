import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseLine } from "../parse-line";
import { enrichSession } from "../enrich-session";
import { parseFullSession } from "../parse-full-session";
import { lookupPricing, computeCost } from "../pricing";
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

const fixturePath = join(import.meta.dir, "fixtures", "minimal-session.jsonl");
const fixtureContent = readFileSync(fixturePath, "utf-8");

const multiBlockFixturePath = join(import.meta.dir, "fixtures", "multi-block-response.jsonl");
const multiBlockFixtureContent = readFileSync(multiBlockFixturePath, "utf-8");

const toolCallCycleFixturePath = join(import.meta.dir, "fixtures", "tool-call-cycle.jsonl");
const toolCallCycleFixtureContent = readFileSync(toolCallCycleFixturePath, "utf-8");

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

  it("returns empty toolCalls when no tool_use blocks exist", () => {
    expect(session.toolCalls).toEqual([]);
    expect(session.totals.toolUseCount).toBe(0);
  });

  it("returns empty enrichments for unimplemented features", () => {
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

// ============================================================
// Unit 6: parseLine — Progress Subtypes
// ============================================================

describe("parseLine — progress agent_progress", () => {
  const record = makeProgressAgent("a748733", "Search the codebase for X", "toolu_spawn_001");
  const msg = parseLine(toLine(record), 30);

  it("returns kind progress-agent", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("progress-agent");
  });

  it("extracts agentId", () => {
    if (msg!.kind !== "progress-agent") throw new Error("wrong kind");
    expect(msg!.agentId).toBe("a748733");
  });

  it("extracts prompt", () => {
    if (msg!.kind !== "progress-agent") throw new Error("wrong kind");
    expect(msg!.prompt).toBe("Search the codebase for X");
  });

  it("extracts parentToolUseID", () => {
    if (msg!.kind !== "progress-agent") throw new Error("wrong kind");
    expect(msg!.parentToolUseID).toBe("toolu_spawn_001");
  });

  it("preserves lineIndex", () => {
    if (msg!.kind !== "progress-agent") throw new Error("wrong kind");
    expect(msg!.lineIndex).toBe(30);
  });
});

describe("parseLine — progress agent_progress with default helper values", () => {
  const record = makeProgressAgent("agent-001", "Do something");
  const msg = parseLine(toLine(record), 0);

  it("uses helper default for parentToolUseID", () => {
    if (msg!.kind !== "progress-agent") throw new Error("wrong kind");
    expect(msg!.parentToolUseID).toBe("toolu_agent_001");
  });
});

describe("parseLine — progress agent_progress missing required field → MalformedRecord", () => {
  const record = {
    type: "progress",
    data: {
      type: "agent_progress",
      agentId: "a123",
      // missing prompt and parentToolUseID
    },
  };
  const msg = parseLine(toLine(record), 0);

  it("returns malformed when required fields are missing", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — progress bash_progress", () => {
  const record = makeProgressBash("total 42\ndrwxr-xr-x  5 user", 3.7);
  const msg = parseLine(toLine(record), 35);

  it("returns kind progress-bash", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("progress-bash");
  });

  it("extracts output", () => {
    if (msg!.kind !== "progress-bash") throw new Error("wrong kind");
    expect(msg!.output).toBe("total 42\ndrwxr-xr-x  5 user");
  });

  it("extracts elapsedTimeSeconds", () => {
    if (msg!.kind !== "progress-bash") throw new Error("wrong kind");
    expect(msg!.elapsedTimeSeconds).toBe(3.7);
  });

  it("preserves lineIndex", () => {
    if (msg!.kind !== "progress-bash") throw new Error("wrong kind");
    expect(msg!.lineIndex).toBe(35);
  });
});

describe("parseLine — progress bash_progress with default helper values", () => {
  const record = makeProgressBash("ls output");
  const msg = parseLine(toLine(record), 0);

  it("uses helper default for elapsedTimeSeconds", () => {
    if (msg!.kind !== "progress-bash") throw new Error("wrong kind");
    expect(msg!.elapsedTimeSeconds).toBe(1.5);
  });
});

describe("parseLine — progress bash_progress missing required field → MalformedRecord", () => {
  const record = {
    type: "progress",
    data: {
      type: "bash_progress",
      output: "some output",
      // missing elapsedTimeSeconds
    },
  };
  const msg = parseLine(toLine(record), 0);

  it("returns malformed when required fields are missing", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — progress hook_progress", () => {
  const record = makeProgressHook("pre-tool-use", "lint-check", "eslint --fix src/");
  const msg = parseLine(toLine(record), 40);

  it("returns kind progress-hook", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("progress-hook");
  });

  it("extracts hookEvent", () => {
    if (msg!.kind !== "progress-hook") throw new Error("wrong kind");
    expect(msg!.hookEvent).toBe("pre-tool-use");
  });

  it("extracts hookName", () => {
    if (msg!.kind !== "progress-hook") throw new Error("wrong kind");
    expect(msg!.hookName).toBe("lint-check");
  });

  it("extracts command", () => {
    if (msg!.kind !== "progress-hook") throw new Error("wrong kind");
    expect(msg!.command).toBe("eslint --fix src/");
  });

  it("preserves lineIndex", () => {
    if (msg!.kind !== "progress-hook") throw new Error("wrong kind");
    expect(msg!.lineIndex).toBe(40);
  });
});

describe("parseLine — progress hook_progress missing required field → MalformedRecord", () => {
  const record = {
    type: "progress",
    data: {
      type: "hook_progress",
      hookEvent: "pre-tool-use",
      // missing hookName and command
    },
  };
  const msg = parseLine(toLine(record), 0);

  it("returns malformed when required fields are missing", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — unknown progress data type → MalformedRecord", () => {
  const record = {
    type: "progress",
    data: {
      type: "unknown_progress_xyz",
      someField: "value",
    },
  };
  const msg = parseLine(toLine(record), 45);

  it("returns malformed for unknown data type", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });

  it("includes data type name in error message", () => {
    if (msg!.kind !== "malformed") throw new Error("wrong kind");
    expect(msg!.error).toContain("unknown_progress_xyz");
  });

  it("preserves lineIndex", () => {
    if (msg!.kind !== "malformed") throw new Error("wrong kind");
    expect(msg!.lineIndex).toBe(45);
  });
});

// ============================================================
// Unit 7: parseLine — Queue Operation + Edge Cases
// ============================================================

describe("parseLine — queue-operation enqueue with content", () => {
  const record = makeQueueOperation("enqueue", "Run the tests");
  const msg = parseLine(toLine(record), 50);

  it("returns kind queue-operation", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("queue-operation");
  });

  it("extracts operation", () => {
    if (msg!.kind !== "queue-operation") throw new Error("wrong kind");
    expect(msg!.operation).toBe("enqueue");
  });

  it("extracts content", () => {
    if (msg!.kind !== "queue-operation") throw new Error("wrong kind");
    expect(msg!.content).toBe("Run the tests");
  });

  it("preserves lineIndex", () => {
    if (msg!.kind !== "queue-operation") throw new Error("wrong kind");
    expect(msg!.lineIndex).toBe(50);
  });
});

describe("parseLine — queue-operation dequeue without content", () => {
  const record = makeQueueOperation("dequeue");
  const msg = parseLine(toLine(record), 51);

  it("returns kind queue-operation", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("queue-operation");
  });

  it("extracts operation", () => {
    if (msg!.kind !== "queue-operation") throw new Error("wrong kind");
    expect(msg!.operation).toBe("dequeue");
  });

  it("content is undefined when absent", () => {
    if (msg!.kind !== "queue-operation") throw new Error("wrong kind");
    expect(msg!.content).toBeUndefined();
  });
});

describe("parseLine — queue-operation missing operation field → MalformedRecord", () => {
  const record = { type: "queue-operation" };
  const msg = parseLine(toLine(record), 0);

  it("returns malformed when operation is missing", () => {
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });
});

describe("parseLine — edge cases", () => {
  it("empty string → null", () => {
    expect(parseLine("", 0)).toBeNull();
  });

  it("whitespace-only → null", () => {
    expect(parseLine("   \t\n  ", 0)).toBeNull();
  });

  it("invalid JSON → MalformedRecord", () => {
    const msg = parseLine("not json at all", 0);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
    if (msg!.kind === "malformed") {
      expect(msg!.error).toContain("Invalid JSON");
    }
  });

  it("missing type field → MalformedRecord", () => {
    const msg = parseLine(JSON.stringify({ foo: "bar" }), 0);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });

  it("unknown type → MalformedRecord", () => {
    const msg = parseLine(JSON.stringify({ type: "invented-type" }), 0);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });

  it("parseLine never throws for any input", () => {
    const inputs = [
      "",
      "   ",
      "{bad",
      "null",
      "123",
      '"string"',
      "[]",
      "true",
      "undefined",
      '{"type":',
      String.raw`{"type":"user","message":{"role":"user","content":"\u0000"}}`,
    ];
    for (const input of inputs) {
      expect(() => parseLine(input, 0)).not.toThrow();
    }
  });
});

describe("parseLine — Zod validation catches missing required fields", () => {
  it("assistant record without message.id → MalformedRecord with Zod error", () => {
    const record = {
      uuid: "uuid-001",
      parentUuid: null,
      sessionId: "session-001",
      timestamp: "2026-02-18T15:09:10.006Z",
      type: "assistant",
      message: {
        model: "claude-sonnet-4-20250514",
        // missing id
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    };
    const msg = parseLine(JSON.stringify(record), 0);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
    if (msg!.kind === "malformed") {
      expect(msg!.error).toBeTruthy();
    }
  });

  it("user record without sessionId → MalformedRecord", () => {
    const record = {
      uuid: "uuid-001",
      parentUuid: null,
      // missing sessionId
      timestamp: "2026-02-18T15:09:10.006Z",
      type: "user",
      message: { role: "user", content: "hello" },
    };
    const msg = parseLine(JSON.stringify(record), 0);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });

  it("file-history-snapshot without snapshot → MalformedRecord", () => {
    const record = {
      type: "file-history-snapshot",
      messageId: "msg-001",
      // missing snapshot
      isSnapshotUpdate: false,
    };
    const msg = parseLine(JSON.stringify(record), 0);
    expect(msg).not.toBeNull();
    expect(msg!.kind).toBe("malformed");
  });
});

// ============================================================
// Unit 8: enrichSession — Multi-Block Response Reconstitution
// ============================================================

describe("enrichSession — 3-block response fixture", () => {
  const session = parseFullSession(multiBlockFixtureContent);

  it("groups 3 blocks with same messageId into 1 response", () => {
    expect(session.responses).toHaveLength(1);
    const response = session.responses[0];
    expect(response.messageId).toBe("msg-multi-001");
    expect(response.blocks).toHaveLength(3);
  });

  it("orders blocks by lineIndex (thinking, text, tool_use)", () => {
    const blocks = session.responses[0].blocks;
    expect(blocks[0].type).toBe("thinking");
    expect(blocks[1].type).toBe("text");
    expect(blocks[2].type).toBe("tool_use");
  });

  it("takes usage from last block per response", () => {
    const usage = session.responses[0].usage;
    // Last block (tool_use at line 4) has output_tokens: 50
    expect(usage.output_tokens).toBe(50);
    expect(usage.input_tokens).toBe(100);
  });

  it("sets correct model from first block", () => {
    expect(session.responses[0].model).toBe("claude-sonnet-4-20250514");
  });

  it("sets correct lineIndexStart and lineIndexEnd", () => {
    const response = session.responses[0];
    expect(response.lineIndexStart).toBe(2); // first assistant block is line index 2
    expect(response.lineIndexEnd).toBe(4); // last assistant block is line index 4
  });

  it("assigns response to correct turn", () => {
    expect(session.responses[0].turnIndex).toBe(0);
  });

  it("updates turn responseCount", () => {
    expect(session.turns[0].responseCount).toBe(1);
  });

  it("computes token totals from deduplicated response", () => {
    // Only 1 response, so totals come from that response's usage (last block)
    expect(session.totals.inputTokens).toBe(100);
    expect(session.totals.outputTokens).toBe(50);
    expect(session.totals.totalTokens).toBe(150);
  });
});

describe("enrichSession — 2 different messageIds → 2 responses", () => {
  // Build messages: prompt + 2 assistant blocks with different messageIds
  const lines = [
    toLine(makeUserPrompt("multi-response prompt")),
    toLine(makeAssistantRecord(makeTextBlock("First response"), {
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-resp-A",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("First response")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    })),
    toLine(makeAssistantRecord(makeTextBlock("Second response"), {
      uuid: "uuid-asst-002",
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-resp-B",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("Second response")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 25 },
      },
    })),
    toLine(makeTurnDuration("uuid-asst-002", 1000)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("produces 2 separate responses", () => {
    expect(session.responses).toHaveLength(2);
  });

  it("each response has the correct messageId", () => {
    const ids = session.responses.map((r) => r.messageId).sort();
    expect(ids).toEqual(["msg-resp-A", "msg-resp-B"]);
  });

  it("each response has 1 block", () => {
    for (const response of session.responses) {
      expect(response.blocks).toHaveLength(1);
    }
  });

  it("each response has its own usage", () => {
    const respA = session.responses.find((r) => r.messageId === "msg-resp-A")!;
    const respB = session.responses.find((r) => r.messageId === "msg-resp-B")!;
    expect(respA.usage.output_tokens).toBe(10);
    expect(respB.usage.output_tokens).toBe(25);
  });

  it("token totals sum across both responses", () => {
    expect(session.totals.inputTokens).toBe(100); // 50 + 50
    expect(session.totals.outputTokens).toBe(35); // 10 + 25
    expect(session.totals.totalTokens).toBe(135);
  });

  it("turn responseCount reflects both responses", () => {
    expect(session.turns[0].responseCount).toBe(2);
  });
});

describe("enrichSession — usage from last block (multi-block)", () => {
  // 2 blocks sharing messageId with different usage values
  const lines = [
    toLine(makeUserPrompt("usage test")),
    toLine(makeAssistantRecord(makeThinkingBlock("thinking..."), {
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-usage-test",
        type: "message",
        role: "assistant",
        content: [makeThinkingBlock("thinking...")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 200, output_tokens: 10 },
      },
    })),
    toLine(makeAssistantRecord(makeTextBlock("final answer"), {
      uuid: "uuid-asst-002",
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-usage-test",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("final answer")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 200, output_tokens: 80, cache_creation_input_tokens: 15, cache_read_input_tokens: 50 },
      },
    })),
    toLine(makeTurnDuration("uuid-asst-002", 500)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("takes usage from the last block (output_tokens: 80, not 10)", () => {
    expect(session.responses).toHaveLength(1);
    expect(session.responses[0].usage.output_tokens).toBe(80);
    expect(session.responses[0].usage.input_tokens).toBe(200);
  });

  it("includes cache tokens from last block in totals", () => {
    expect(session.totals.cacheCreationInputTokens).toBe(15);
    expect(session.totals.cacheReadInputTokens).toBe(50);
  });
});

describe("enrichSession — synthetic response handling", () => {
  const lines = [
    toLine(makeUserPrompt("trigger error")),
    toLine(makeAssistantRecord(makeTextBlock("An error occurred"), {
      uuid: "uuid-asst-synthetic",
      isApiErrorMessage: true,
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-synthetic-001",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("An error occurred")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })),
    toLine(makeTurnDuration("uuid-asst-synthetic", 100)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("marks reconstituted response as synthetic", () => {
    expect(session.responses).toHaveLength(1);
    expect(session.responses[0].isSynthetic).toBe(true);
  });

  it("preserves messageId on synthetic response", () => {
    expect(session.responses[0].messageId).toBe("msg-synthetic-001");
  });

  it("non-synthetic response defaults isSynthetic to false", () => {
    // Use the minimal fixture (already tested above) to verify the default
    const minimalSession = parseFullSession(fixtureContent);
    expect(minimalSession.responses[0].isSynthetic).toBe(false);
  });
});

// ============================================================
// Unit 9: enrichSession — Tool Call Pairing
// ============================================================

describe("enrichSession — tool call cycle fixture (successful pairing)", () => {
  const session = parseFullSession(toolCallCycleFixtureContent);

  it("produces 1 paired tool call", () => {
    expect(session.toolCalls).toHaveLength(1);
  });

  it("pairs tool_use with tool_result by toolUseId", () => {
    const tc = session.toolCalls[0];
    expect(tc.toolUseId).toBe("toolu_bash_001");
    expect(tc.toolName).toBe("Bash");
    expect(tc.input).toEqual({ command: "ls" });
  });

  it("includes the original tool_use content block", () => {
    const tc = session.toolCalls[0];
    expect(tc.toolUseBlock.type).toBe("tool_use");
    if (tc.toolUseBlock.type === "tool_use") {
      expect(tc.toolUseBlock.id).toBe("toolu_bash_001");
      expect(tc.toolUseBlock.name).toBe("Bash");
    }
  });

  it("includes the matched tool_result block", () => {
    const tc = session.toolCalls[0];
    expect(tc.toolResultBlock).not.toBeNull();
    expect(tc.toolResultBlock!.toolUseId).toBe("toolu_bash_001");
    expect(tc.toolResultBlock!.content).toBe("file1.ts\nfile2.ts\npackage.json");
    expect(tc.toolResultBlock!.isError).toBe(false);
  });

  it("assigns correct turnIndex", () => {
    expect(session.toolCalls[0].turnIndex).toBe(0);
  });

  it("updates toolUseCount in totals", () => {
    expect(session.totals.toolUseCount).toBe(1);
  });

  it("updates toolUseCount on the turn", () => {
    expect(session.turns[0].toolUseCount).toBe(1);
  });

  it("still produces correct responses", () => {
    expect(session.responses).toHaveLength(2);
    expect(session.responses.map((r) => r.messageId).sort()).toEqual(["msg-resp-001", "msg-resp-002"]);
  });
});

describe("enrichSession — error tool result pairing", () => {
  const lines = [
    toLine(makeUserPrompt("Run dangerous command")),
    toLine(makeAssistantRecord(makeToolUseBlock("Bash", { command: "rm -rf /" }, "toolu_err_001"), {
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-err-resp",
        type: "message",
        role: "assistant",
        content: [makeToolUseBlock("Bash", { command: "rm -rf /" }, "toolu_err_001")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 20 },
      },
    })),
    toLine(makeUserToolResult(
      [makeToolResultItem("toolu_err_001", "Error: permission denied", true)],
    )),
    toLine(makeTurnDuration("uuid-asst-001", 500)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("pairs error tool result with isError: true", () => {
    expect(session.toolCalls).toHaveLength(1);
    const tc = session.toolCalls[0];
    expect(tc.toolResultBlock).not.toBeNull();
    expect(tc.toolResultBlock!.isError).toBe(true);
    expect(tc.toolResultBlock!.content).toBe("Error: permission denied");
  });

  it("preserves toolUseId on error pairing", () => {
    expect(session.toolCalls[0].toolUseId).toBe("toolu_err_001");
    expect(session.toolCalls[0].toolName).toBe("Bash");
  });
});

describe("enrichSession — unmatched tool_use → toolResultBlock: null", () => {
  // tool_use block with no corresponding tool_result
  const lines = [
    toLine(makeUserPrompt("Do something")),
    toLine(makeAssistantRecord(makeToolUseBlock("Read", { file_path: "/tmp/test" }, "toolu_unmatched_001"), {
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-unmatched",
        type: "message",
        role: "assistant",
        content: [makeToolUseBlock("Read", { file_path: "/tmp/test" }, "toolu_unmatched_001")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    })),
    toLine(makeTurnDuration("uuid-asst-001", 200)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("creates a paired tool call with null toolResultBlock", () => {
    expect(session.toolCalls).toHaveLength(1);
    const tc = session.toolCalls[0];
    expect(tc.toolUseId).toBe("toolu_unmatched_001");
    expect(tc.toolName).toBe("Read");
    expect(tc.toolResultBlock).toBeNull();
  });

  it("still counts unmatched tool_use in toolUseCount", () => {
    expect(session.totals.toolUseCount).toBe(1);
    expect(session.turns[0].toolUseCount).toBe(1);
  });
});

describe("enrichSession — multiple tool calls across turns", () => {
  const lines = [
    // Turn 0
    toLine(makeUserPrompt("First task")),
    toLine(makeAssistantRecord(makeToolUseBlock("Bash", { command: "ls" }, "toolu_t0_001"), {
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-t0-resp",
        type: "message",
        role: "assistant",
        content: [makeToolUseBlock("Bash", { command: "ls" }, "toolu_t0_001")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    })),
    toLine(makeUserToolResult([makeToolResultItem("toolu_t0_001", "output1")])),
    toLine(makeAssistantRecord(makeToolUseBlock("Read", { file_path: "/a" }, "toolu_t0_002"), {
      uuid: "uuid-asst-002",
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-t0-resp2",
        type: "message",
        role: "assistant",
        content: [makeToolUseBlock("Read", { file_path: "/a" }, "toolu_t0_002")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 60, output_tokens: 15 },
      },
    })),
    toLine(makeUserToolResult([makeToolResultItem("toolu_t0_002", "file contents")])),
    toLine(makeTurnDuration("uuid-asst-002", 1000)),
    // Turn 1
    toLine(makeUserPrompt("Second task", { uuid: "uuid-user-002", parentUuid: null })),
    toLine(makeAssistantRecord(makeToolUseBlock("Write", { file_path: "/b" }, "toolu_t1_001"), {
      uuid: "uuid-asst-003",
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-t1-resp",
        type: "message",
        role: "assistant",
        content: [makeToolUseBlock("Write", { file_path: "/b" }, "toolu_t1_001")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 70, output_tokens: 20 },
      },
    })),
    toLine(makeUserToolResult([makeToolResultItem("toolu_t1_001", "written")])),
    toLine(makeTurnDuration("uuid-asst-003", 800)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("produces 3 paired tool calls total", () => {
    expect(session.toolCalls).toHaveLength(3);
  });

  it("assigns turn 0 tool calls to turnIndex 0", () => {
    const t0Calls = session.toolCalls.filter((tc) => tc.turnIndex === 0);
    expect(t0Calls).toHaveLength(2);
    expect(t0Calls.map((tc) => tc.toolName).sort()).toEqual(["Bash", "Read"]);
  });

  it("assigns turn 1 tool call to turnIndex 1", () => {
    const t1Calls = session.toolCalls.filter((tc) => tc.turnIndex === 1);
    expect(t1Calls).toHaveLength(1);
    expect(t1Calls[0].toolName).toBe("Write");
  });

  it("all tool calls are successfully paired", () => {
    for (const tc of session.toolCalls) {
      expect(tc.toolResultBlock).not.toBeNull();
    }
  });

  it("updates toolUseCount per turn", () => {
    expect(session.turns[0].toolUseCount).toBe(2);
    expect(session.turns[1].toolUseCount).toBe(1);
  });

  it("toolUseCount in totals reflects all tool calls", () => {
    expect(session.totals.toolUseCount).toBe(3);
  });
});

// ============================================================
// Unit 10: enrichSession — Token Aggregation + Cost
// ============================================================

describe("lookupPricing — model prefix matching", () => {
  it("matches claude-sonnet-4-20250514", () => {
    const p = lookupPricing("claude-sonnet-4-20250514");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(3);
    expect(p!.outputPerMTok).toBe(15);
  });

  it("matches claude-opus-4-6", () => {
    const p = lookupPricing("claude-opus-4-6");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(5);
    expect(p!.outputPerMTok).toBe(25);
  });

  it("matches claude-opus-4-5-20250101", () => {
    const p = lookupPricing("claude-opus-4-5-20250101");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(5);
  });

  it("matches claude-opus-4-20250514 (legacy pricing)", () => {
    const p = lookupPricing("claude-opus-4-20250514");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(15);
    expect(p!.outputPerMTok).toBe(75);
  });

  it("matches claude-opus-4-1-20250514 (legacy pricing)", () => {
    const p = lookupPricing("claude-opus-4-1-20250514");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(15);
  });

  it("matches claude-opus-3-20240229", () => {
    const p = lookupPricing("claude-opus-3-20240229");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(15);
  });

  it("matches claude-haiku-4-5-20251001", () => {
    const p = lookupPricing("claude-haiku-4-5-20251001");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(1);
    expect(p!.outputPerMTok).toBe(5);
  });

  it("matches claude-haiku-3-5-20241022", () => {
    const p = lookupPricing("claude-haiku-3-5-20241022");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(0.8);
    expect(p!.outputPerMTok).toBe(4);
  });

  it("matches claude-haiku-3-20240307", () => {
    const p = lookupPricing("claude-haiku-3-20240307");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(0.25);
    expect(p!.outputPerMTok).toBe(1.25);
  });

  it("matches claude-sonnet-4-6-20250514", () => {
    const p = lookupPricing("claude-sonnet-4-6-20250514");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(3);
  });

  it("matches claude-sonnet-3-7-20250219", () => {
    const p = lookupPricing("claude-sonnet-3-7-20250219");
    expect(p).not.toBeNull();
    expect(p!.inputPerMTok).toBe(3);
  });

  it("returns null for unknown model", () => {
    expect(lookupPricing("gpt-4o")).toBeNull();
    expect(lookupPricing("<synthetic>")).toBeNull();
    expect(lookupPricing("unknown-model")).toBeNull();
  });
});

describe("computeCost — cost calculation", () => {
  it("computes cost for sonnet with known token counts", () => {
    // 1000 input tokens at $3/MTok = $0.003
    // 500 output tokens at $15/MTok = $0.0075
    const cost = computeCost(1000, 500, 0, 0, "claude-sonnet-4-20250514");
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it("computes cost for opus 4.6", () => {
    // 1M input at $5 + 1M output at $25 = $30
    const cost = computeCost(1_000_000, 1_000_000, 0, 0, "claude-opus-4-6");
    expect(cost).toBeCloseTo(30, 6);
  });

  it("returns 0 for unknown model", () => {
    expect(computeCost(1_000_000, 1_000_000, 0, 0, "<synthetic>")).toBe(0);
    expect(computeCost(1_000_000, 1_000_000, 0, 0, "unknown")).toBe(0);
  });

  it("includes cache write cost", () => {
    // 100k cache write at $3.75/MTok = $0.375
    const cost = computeCost(0, 0, 100_000, 0, "claude-sonnet-4-20250514");
    expect(cost).toBeCloseTo(0.375, 6);
  });

  it("includes cache read cost", () => {
    // 100k cache read at $0.30/MTok = $0.03
    const cost = computeCost(0, 0, 0, 100_000, "claude-sonnet-4-20250514");
    expect(cost).toBeCloseTo(0.03, 6);
  });

  it("sums all four cost components", () => {
    // 10k input at $3/MTok = $0.03
    // 5k output at $15/MTok = $0.075
    // 20k cache write at $3.75/MTok = $0.075
    // 50k cache read at $0.30/MTok = $0.015
    const cost = computeCost(10_000, 5_000, 20_000, 50_000, "claude-sonnet-4-20250514");
    expect(cost).toBeCloseTo(0.195, 6);
  });
});

describe("enrichSession — token deduplication by messageId", () => {
  // Two blocks sharing the same messageId — usage should come from last block only (not summed)
  const lines = [
    toLine(makeUserPrompt("dedup test")),
    toLine(makeAssistantRecord(makeThinkingBlock("thinking..."), {
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-dedup-001",
        type: "message",
        role: "assistant",
        content: [makeThinkingBlock("thinking...")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    })),
    toLine(makeAssistantRecord(makeTextBlock("answer"), {
      uuid: "uuid-asst-002",
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-dedup-001",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("answer")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    })),
    toLine(makeTurnDuration("uuid-asst-002", 500)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("creates 1 response from 2 blocks with same messageId", () => {
    expect(session.responses).toHaveLength(1);
    expect(session.responses[0].messageId).toBe("msg-dedup-001");
  });

  it("takes token usage from last block only (not summed)", () => {
    expect(session.totals.inputTokens).toBe(100); // not 200
    expect(session.totals.outputTokens).toBe(50); // not 60
    expect(session.totals.totalTokens).toBe(150);
  });
});

describe("enrichSession — cost summation across responses", () => {
  const lines = [
    toLine(makeUserPrompt("cost test")),
    toLine(makeAssistantRecord(makeTextBlock("response 1"), {
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-cost-A",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("response 1")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
    })),
    toLine(makeAssistantRecord(makeTextBlock("response 2"), {
      uuid: "uuid-asst-002",
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-cost-B",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("response 2")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 2000, output_tokens: 1000 },
      },
    })),
    toLine(makeTurnDuration("uuid-asst-002", 1000)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("sums tokens across both responses", () => {
    expect(session.totals.inputTokens).toBe(3000);
    expect(session.totals.outputTokens).toBe(1500);
    expect(session.totals.totalTokens).toBe(4500);
  });

  it("computes cost for known sonnet model", () => {
    // Response A: 1k input * $3/MTok + 500 output * $15/MTok = $0.003 + $0.0075 = $0.0105
    // Response B: 2k input * $3/MTok + 1k output * $15/MTok = $0.006 + $0.015 = $0.021
    // Total: $0.0315
    expect(session.totals.estimatedCostUsd).toBeCloseTo(0.0315, 6);
  });
});

describe("enrichSession — unknown model → cost 0", () => {
  const lines = [
    toLine(makeUserPrompt("synthetic test")),
    toLine(makeAssistantRecord(makeTextBlock("error message"), {
      isApiErrorMessage: true,
      message: {
        model: "<synthetic>",
        id: "msg-synth-cost",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("error message")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })),
    toLine(makeTurnDuration("uuid-asst-001", 100)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("returns estimatedCostUsd of 0 for unknown model", () => {
    expect(session.totals.estimatedCostUsd).toBe(0);
  });
});

describe("enrichSession — cache token aggregation in cost", () => {
  const lines = [
    toLine(makeUserPrompt("cache test")),
    toLine(makeAssistantRecord(makeTextBlock("cached response"), {
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-cache-cost",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("cached response")],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 10_000,
          output_tokens: 5_000,
          cache_creation_input_tokens: 20_000,
          cache_read_input_tokens: 50_000,
        },
      },
    })),
    toLine(makeTurnDuration("uuid-asst-001", 500)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("includes cache tokens in totals", () => {
    expect(session.totals.cacheCreationInputTokens).toBe(20_000);
    expect(session.totals.cacheReadInputTokens).toBe(50_000);
  });

  it("includes cache token costs in estimatedCostUsd", () => {
    // input: 10k * $3/MTok = $0.03
    // output: 5k * $15/MTok = $0.075
    // cache write: 20k * $3.75/MTok = $0.075
    // cache read: 50k * $0.30/MTok = $0.015
    // Total: $0.195
    expect(session.totals.estimatedCostUsd).toBeCloseTo(0.195, 6);
  });
});

describe("enrichSession — cost with mixed models", () => {
  const lines = [
    toLine(makeUserPrompt("mixed models")),
    toLine(makeAssistantRecord(makeTextBlock("sonnet response"), {
      message: {
        model: "claude-sonnet-4-20250514",
        id: "msg-mixed-A",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("sonnet response")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
      },
    })),
    toLine(makeAssistantRecord(makeTextBlock("opus response"), {
      uuid: "uuid-asst-002",
      message: {
        model: "claude-opus-4-6",
        id: "msg-mixed-B",
        type: "message",
        role: "assistant",
        content: [makeTextBlock("opus response")],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
      },
    })),
    toLine(makeTurnDuration("uuid-asst-002", 2000)),
  ];

  const messages = lines.map((line, i) => parseLine(line, i)).filter((m) => m !== null);
  const session = enrichSession(messages);

  it("computes per-model cost and sums correctly", () => {
    // Sonnet: 1M * $3 + 100k * $15 = $3 + $1.5 = $4.5
    // Opus 4.6: 1M * $5 + 100k * $25 = $5 + $2.5 = $7.5
    // Total: $12
    expect(session.totals.estimatedCostUsd).toBeCloseTo(12, 6);
  });
});
