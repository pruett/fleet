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
