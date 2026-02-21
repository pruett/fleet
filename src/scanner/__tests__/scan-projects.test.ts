import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { scanProjects } from "../scan-projects";

const FIXTURES = join(import.meta.dir, "fixtures");
const BASE_PATH = join(FIXTURES, "base-path");
const FILTERING_BASE = join(FIXTURES, "filtering-base");

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
});
