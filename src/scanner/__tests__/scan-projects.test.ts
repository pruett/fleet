import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { scanProjects } from "../scan-projects";

const FIXTURES = join(import.meta.dir, "fixtures");
const BASE_PATH = join(FIXTURES, "base-path");
const FILTERING_BASE = join(FIXTURES, "filtering-base");
const RESILIENCE_BASE = join(FIXTURES, "resilience-base");
const MULTI_SOURCE_BASE_1 = join(FIXTURES, "multi-source-base-1");
const MULTI_SOURCE_BASE_2 = join(FIXTURES, "multi-source-base-2");
const SORTING_BASE = join(FIXTURES, "sorting-base");

describe("scanProjects", () => {
  it("returns one project from the fixture base path", async () => {
    const projects = await scanProjects([BASE_PATH]);

    expect(projects).toHaveLength(1);

    const project = projects[0];
    expect(project.id).toBe("-Users-foo-code-bar");
    expect(project.path).toBe("/Users/foo/code/bar");
    expect(project.source).toBe(BASE_PATH);
    expect(project.sessionCount).toBe(1);
    expect(project.lastActiveAt).toBe("2026-02-18T10:00:02.000Z");
  });

  it("silently skips a missing base path", async () => {
    const projects = await scanProjects([join(FIXTURES, "does-not-exist")]);

    expect(projects).toHaveLength(0);
  });

  it("merges results from multiple base paths", async () => {
    const missing = join(FIXTURES, "does-not-exist");
    const projects = await scanProjects([missing, BASE_PATH]);

    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe("-Users-foo-code-bar");
  });

  describe("directory filtering", () => {
    it("skips the memory directory under base path", async () => {
      // filtering-base/ contains memory/ dir — should be excluded
      const projects = await scanProjects([FILTERING_BASE]);
      const ids = projects.map((p) => p.id);
      expect(ids).not.toContain("memory");
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("-Users-test-project");
    });

    it("skips dot-prefixed directories under base path", async () => {
      // filtering-base/ contains .hidden/ dir — should be excluded
      const projects = await scanProjects([FILTERING_BASE]);
      const ids = projects.map((p) => p.id);
      expect(ids).not.toContain(".hidden");
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("-Users-test-project");
    });
  });

  describe("resilience", () => {
    it("returns sessionCount: 0 and lastActiveAt: null for an empty project directory", async () => {
      const projects = await scanProjects([RESILIENCE_BASE]);

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("-Users-empty-project");
      expect(projects[0].sessionCount).toBe(0);
      expect(projects[0].lastActiveAt).toBeNull();
    });

    it("silently skips a missing base path without throwing", async () => {
      const projects = await scanProjects([
        join(FIXTURES, "nonexistent-path"),
      ]);

      expect(projects).toHaveLength(0);
    });
  });

  describe("multiple base paths", () => {
    it("returns separate entries for same directory name under different base paths", async () => {
      const projects = await scanProjects([
        MULTI_SOURCE_BASE_1,
        MULTI_SOURCE_BASE_2,
      ]);

      // Both base paths have -Users-shared-project — should produce 2 separate entries
      const shared = projects.filter((p) => p.id === "-Users-shared-project");
      expect(shared).toHaveLength(2);

      const sources = shared.map((p) => p.source);
      expect(sources).toContain(MULTI_SOURCE_BASE_1);
      expect(sources).toContain(MULTI_SOURCE_BASE_2);
    });

    it("merges and sorts results by lastActiveAt descending across all base paths", async () => {
      const projects = await scanProjects([
        MULTI_SOURCE_BASE_1,
        MULTI_SOURCE_BASE_2,
      ]);

      // base-1 has: -Users-alpha-repo (T3=2026-02-19) and -Users-shared-project (T1=2026-02-15)
      // base-2 has: -Users-shared-project (T2=2026-02-17)
      expect(projects).toHaveLength(3);

      // Sorted desc: alpha-repo (Feb 19), base-2/shared (Feb 17), base-1/shared (Feb 15)
      expect(projects[0].id).toBe("-Users-alpha-repo");
      expect(projects[0].lastActiveAt).toBe("2026-02-19T10:00:01.000Z");

      expect(projects[1].id).toBe("-Users-shared-project");
      expect(projects[1].source).toBe(MULTI_SOURCE_BASE_2);
      expect(projects[1].lastActiveAt).toBe("2026-02-17T10:00:01.000Z");

      expect(projects[2].id).toBe("-Users-shared-project");
      expect(projects[2].source).toBe(MULTI_SOURCE_BASE_1);
      expect(projects[2].lastActiveAt).toBe("2026-02-15T10:00:01.000Z");
    });

    it("returns results from valid path only when one base path is missing", async () => {
      const missing = join(FIXTURES, "nonexistent-base");
      const projects = await scanProjects([missing, MULTI_SOURCE_BASE_2]);

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("-Users-shared-project");
      expect(projects[0].source).toBe(MULTI_SOURCE_BASE_2);
    });
  });

  describe("sorting", () => {
    it("returns projects sorted by lastActiveAt descending (most recent first)", async () => {
      const projects = await scanProjects([SORTING_BASE]);

      // sorting-base has 4 project dirs:
      //   -Users-project-recent  (Feb 19)
      //   -Users-multi-session   (Feb 16 — most recent of its 3 sessions)
      //   -Users-project-old     (Feb 12)
      //   -Users-project-empty   (null — no sessions)
      expect(projects).toHaveLength(4);

      expect(projects[0].id).toBe("-Users-project-recent");
      expect(projects[0].lastActiveAt).toBe("2026-02-19T10:00:01.000Z");

      expect(projects[1].id).toBe("-Users-multi-session");
      expect(projects[1].lastActiveAt).toBe("2026-02-16T10:00:01.000Z");

      expect(projects[2].id).toBe("-Users-project-old");
      expect(projects[2].lastActiveAt).toBe("2026-02-12T10:00:01.000Z");
    });

    it("sorts projects with null lastActiveAt (empty project) last", async () => {
      const projects = await scanProjects([SORTING_BASE]);

      // The empty project has no sessions → lastActiveAt: null → sorts last
      const last = projects[projects.length - 1];
      expect(last.id).toBe("-Users-project-empty");
      expect(last.lastActiveAt).toBeNull();
      expect(last.sessionCount).toBe(0);
    });
  });
});
