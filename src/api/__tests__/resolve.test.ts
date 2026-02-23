import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { resolveProjectDir, resolveSessionFile } from "../resolve";

const FIXTURES = join(import.meta.dir, "fixtures");
const BASE_1 = join(FIXTURES, "resolve-base-1");
const BASE_2 = join(FIXTURES, "resolve-base-2");
const MISSING = join(FIXTURES, "nonexistent-base");

describe("resolveProjectDir", () => {
  test("returns path when project directory exists", async () => {
    const result = await resolveProjectDir([BASE_1], "-Users-project-alpha");
    expect(result).toBe(join(BASE_1, "-Users-project-alpha"));
  });

  test("returns null when project directory does not exist", async () => {
    const result = await resolveProjectDir([BASE_1], "-Users-nonexistent");
    expect(result).toBeNull();
  });

  test("returns first match when project exists in multiple basePaths", async () => {
    const result = await resolveProjectDir(
      [BASE_1, BASE_2],
      "-Users-project-shared",
    );
    expect(result).toBe(join(BASE_1, "-Users-project-shared"));
  });

  test("skips missing basePath and finds in next", async () => {
    const result = await resolveProjectDir(
      [MISSING, BASE_1],
      "-Users-project-alpha",
    );
    expect(result).toBe(join(BASE_1, "-Users-project-alpha"));
  });

  test("returns null when all basePaths are missing", async () => {
    const result = await resolveProjectDir([MISSING], "-Users-project-alpha");
    expect(result).toBeNull();
  });
});

describe("resolveSessionFile", () => {
  test("returns path when session file exists", async () => {
    const result = await resolveSessionFile(
      [BASE_1],
      "aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(result).toBe(
      join(
        BASE_1,
        "-Users-project-alpha",
        "aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl",
      ),
    );
  });

  test("returns null when session file does not exist", async () => {
    const result = await resolveSessionFile(
      [BASE_1],
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    );
    expect(result).toBeNull();
  });

  test("returns first match when session exists under multiple basePaths", async () => {
    const result = await resolveSessionFile(
      [BASE_1, BASE_2],
      "bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    );
    // Should find in BASE_1/-Users-project-shared/, not search BASE_2
    expect(result).toBe(
      join(
        BASE_1,
        "-Users-project-shared",
        "bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl",
      ),
    );
  });

  test("skips missing basePath and finds in next", async () => {
    const result = await resolveSessionFile(
      [MISSING, BASE_2],
      "cccc3333-cccc-cccc-cccc-cccccccccccc",
    );
    expect(result).toBe(
      join(
        BASE_2,
        "-Users-project-shared",
        "cccc3333-cccc-cccc-cccc-cccccccccccc.jsonl",
      ),
    );
  });

  test("returns null when all basePaths are missing", async () => {
    const result = await resolveSessionFile(
      [MISSING],
      "aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(result).toBeNull();
  });
});
