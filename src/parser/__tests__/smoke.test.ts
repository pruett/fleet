import { describe, expect, it } from "bun:test";

describe("smoke test", () => {
  it("imports from parser/index without error", async () => {
    const mod = await import("../index");
    expect(mod).toBeDefined();
  });

  it("basic sanity check", () => {
    expect(1 + 1).toBe(2);
  });
});

describe("Unit 17 — Public API and Exports", () => {
  it("exports parseLine as a function", async () => {
    const { parseLine } = await import("../index");
    expect(typeof parseLine).toBe("function");
  });

  it("exports enrichSession as a function", async () => {
    const { enrichSession } = await import("../index");
    expect(typeof enrichSession).toBe("function");
  });

  it("exports parseFullSession as a function", async () => {
    const { parseFullSession } = await import("../index");
    expect(typeof parseFullSession).toBe("function");
  });

  it("exports lookupPricing and computeCost as functions", async () => {
    const { lookupPricing, computeCost } = await import("../index");
    expect(typeof lookupPricing).toBe("function");
    expect(typeof computeCost).toBe("function");
  });

  it("parseLine is callable and returns a result", () => {
    const { parseLine } = require("../index");
    const result = parseLine("", 0);
    expect(result).toBeNull();
  });

  it("enrichSession is callable and returns an EnrichedSession", () => {
    const { enrichSession } = require("../index");
    const session = enrichSession([]);
    expect(session).toHaveProperty("messages");
    expect(session).toHaveProperty("turns");
    expect(session).toHaveProperty("responses");
    expect(session).toHaveProperty("toolCalls");
    expect(session).toHaveProperty("totals");
    expect(session).toHaveProperty("toolStats");
    expect(session).toHaveProperty("subagents");
    expect(session).toHaveProperty("contextSnapshots");
  });

  it("parseFullSession is callable and returns an EnrichedSession", () => {
    const { parseFullSession } = require("../index");
    const session = parseFullSession("");
    expect(session).toHaveProperty("messages");
    expect(session).toHaveProperty("turns");
    expect(session).toHaveProperty("responses");
    expect(session).toHaveProperty("toolCalls");
    expect(session).toHaveProperty("totals");
    expect(session).toHaveProperty("toolStats");
    expect(session).toHaveProperty("subagents");
    expect(session).toHaveProperty("contextSnapshots");
  });
});
