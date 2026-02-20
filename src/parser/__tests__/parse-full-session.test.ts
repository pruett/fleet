import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseLine } from "../parse-line";
import { parseFullSession } from "../parse-full-session";
import {
  makeFileHistorySnapshot,
  makeUserPrompt,
  makeAssistantRecord,
  makeTextBlock,
  makeTurnDuration,
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
