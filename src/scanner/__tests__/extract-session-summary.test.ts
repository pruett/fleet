import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { extractSessionSummary } from "../extract-session-summary";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("extractSessionSummary — usage extraction", () => {
  it("deduplicates multi-block responses, keeping only last block's usage", async () => {
    // Fixture has 3 assistant lines with the same message.id ("msg-resp-001")
    // Block 1: input=100, output=10
    // Block 2: input=100, output=30
    // Block 3: input=100, output=50 (last occurrence — should be the one counted)
    const summary = await extractSessionSummary(
      join(FIXTURES, "multi-block-response.jsonl"),
      "test-multi-block",
    );

    expect(summary.inputTokens).toBe(100);
    expect(summary.outputTokens).toBe(50);
    expect(summary.cacheCreationTokens).toBe(0);
    expect(summary.cacheReadTokens).toBe(0);
    expect(summary.model).toBe("claude-sonnet-4-20250514");
  });

  it("sums usage across multiple responses with different message.ids", async () => {
    // Fixture has 2 assistant lines with different message.ids
    // Response 1 (msg-resp-001): input=1000, output=200, cacheCreation=500, cacheRead=300
    // Response 2 (msg-resp-002): input=2000, output=400, cacheCreation=0,   cacheRead=800
    const summary = await extractSessionSummary(
      join(FIXTURES, "multiple-responses.jsonl"),
      "test-multiple-responses",
    );

    expect(summary.inputTokens).toBe(3000);
    expect(summary.outputTokens).toBe(600);
    expect(summary.cacheCreationTokens).toBe(500);
    expect(summary.cacheReadTokens).toBe(1100);
  });

  it("computes cost matching manual pricing table calculation", async () => {
    // SONNET pricing: input=$3/MTok, output=$15/MTok, cacheWrite=$3.75/MTok, cacheRead=$0.30/MTok
    // Response 1: (1000/1e6)*3 + (200/1e6)*15 + (500/1e6)*3.75 + (300/1e6)*0.30 = 0.007965
    // Response 2: (2000/1e6)*3 + (400/1e6)*15 + (0/1e6)*3.75   + (800/1e6)*0.30 = 0.01224
    // Total: 0.020205
    const summary = await extractSessionSummary(
      join(FIXTURES, "multiple-responses.jsonl"),
      "test-cost",
    );

    expect(summary.cost).toBeCloseTo(0.020205, 10);
  });

  it("returns cost 0 for unknown model while still summing tokens", async () => {
    // Fixture has an assistant with model "unknown-future-model-v1"
    // Tokens: input=500, output=100
    const summary = await extractSessionSummary(
      join(FIXTURES, "unknown-model.jsonl"),
      "test-unknown-model",
    );

    expect(summary.model).toBe("unknown-future-model-v1");
    expect(summary.inputTokens).toBe(500);
    expect(summary.outputTokens).toBe(100);
    expect(summary.cost).toBe(0);
  });
});

describe("extractSessionSummary — header extraction edge cases", () => {
  it("skips meta user records and returns firstPrompt: null when only meta prompts exist", async () => {
    const summary = await extractSessionSummary(
      join(FIXTURES, "meta-only-prompts.jsonl"),
      "test-meta-only",
    );

    expect(summary.firstPrompt).toBeNull();
    expect(summary.cwd).toBeNull();
    expect(summary.gitBranch).toBeNull();
    // Assistant record still parsed for model and tokens
    expect(summary.model).toBe("claude-sonnet-4-20250514");
    expect(summary.inputTokens).toBe(50);
    expect(summary.outputTokens).toBe(10);
    // Timestamps still extracted
    expect(summary.startedAt).toBe("2026-02-18T10:00:00.000Z");
    expect(summary.lastActiveAt).toBe("2026-02-18T10:00:03.000Z");
  });

  it("returns firstPrompt: null, model: null, zero tokens for snapshot-only session", async () => {
    const summary = await extractSessionSummary(
      join(FIXTURES, "snapshot-only.jsonl"),
      "test-snapshot-only",
    );

    expect(summary.firstPrompt).toBeNull();
    expect(summary.model).toBeNull();
    expect(summary.inputTokens).toBe(0);
    expect(summary.outputTokens).toBe(0);
    expect(summary.cacheCreationTokens).toBe(0);
    expect(summary.cacheReadTokens).toBe(0);
    expect(summary.cost).toBe(0);
    // startedAt comes from the snapshot.timestamp
    expect(summary.startedAt).toBe("2026-02-18T10:00:00.000Z");
    // No line with a top-level timestamp → lastActiveAt null
    expect(summary.lastActiveAt).toBeNull();
  });

  it("truncates firstPrompt to 200 characters", async () => {
    const summary = await extractSessionSummary(
      join(FIXTURES, "long-first-prompt.jsonl"),
      "test-truncation",
    );

    const fullContent =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
      "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris " +
      "nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in rep";

    expect(fullContent.length).toBeGreaterThan(200);
    expect(summary.firstPrompt).toBe(fullContent.slice(0, 200));
    expect(summary.firstPrompt!.length).toBe(200);
  });
});
