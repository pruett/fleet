/**
 * API Contract Test — Parser Module
 *
 * Guards the parser's public API surface so that any addition, removal,
 * or rename of an export causes an explicit, reviewable test failure.
 *
 * Runtime layer:  bun test  — checks export names and types at runtime
 * Compile-time layer:  tsc --noEmit  — checks type export existence and key fields
 */

import { describe, expect, it } from "bun:test";
import * as parser from "../index";

// ────────────────────────────────────────────────────────────
// Compile-time layer — type imports & structural guards
// ────────────────────────────────────────────────────────────

import type { ParsedMessage, EnrichedSession } from "../index";

import type { Turn, TokenTotals, PairedToolCall, ToolStat } from "../types";

// Structural assertions — if a required field is removed, tsc fails.
// The mapped type picks specific keys; a missing key is a compile error.

type _AssertEnrichedSession = Pick<
  EnrichedSession,
  | "messages"
  | "turns"
  | "responses"
  | "toolCalls"
  | "totals"
  | "toolStats"
  | "subagents"
  | "contextSnapshots"
>;

type _AssertTurn = Pick<
  Turn,
  "turnIndex" | "promptText" | "durationMs" | "responseCount" | "toolUseCount"
>;

type _AssertTokenTotals = Pick<
  TokenTotals,
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "estimatedCostUsd"
  | "toolUseCount"
>;

type _AssertPairedToolCall = Pick<
  PairedToolCall,
  "toolUseId" | "toolName" | "input" | "toolUseBlock" | "toolResultBlock"
>;

type _AssertToolStat = Pick<ToolStat, "toolName" | "callCount" | "errorCount">;

// Prevent "unused" warnings while keeping the compile-time checks alive.
type _UseAll =
  | ParsedMessage
  | EnrichedSession
  | _AssertEnrichedSession
  | _AssertTurn
  | _AssertTokenTotals
  | _AssertPairedToolCall
  | _AssertToolStat;

// ────────────────────────────────────────────────────────────
// Runtime layer — export name & type checks
// ────────────────────────────────────────────────────────────

const EXPECTED_RUNTIME_EXPORTS = ["parseFullSession", "parseLine"];

describe("Parser API Contract", () => {
  it("exports exactly the expected runtime symbols", () => {
    const actual = Object.keys(parser).sort();
    expect(actual).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it("every runtime export is a function", () => {
    for (const name of EXPECTED_RUNTIME_EXPORTS) {
      expect(typeof (parser as Record<string, unknown>)[name]).toBe(
        "function",
      );
    }
  });
});
