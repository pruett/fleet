import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { scanProjects, scanSessions } from "../index";
import type { ProjectSummary, SessionSummary } from "../index";

const FIXTURES = join(import.meta.dir, "fixtures");
const BASE_PATH = join(FIXTURES, "base-path");
const PROJECT_DIR = join(BASE_PATH, "-Users-foo-code-bar");

describe("public API (index.ts)", () => {
  it("scanProjects is callable and returns ProjectSummary[]", async () => {
    const projects = await scanProjects([BASE_PATH]);

    expect(projects.length).toBeGreaterThan(0);

    const project: ProjectSummary = projects[0];
    expect(project.id).toBeDefined();
    expect(project.source).toBeDefined();
    expect(project.path).toBeDefined();
    expect(typeof project.sessionCount).toBe("number");
  });

  it("scanSessions is callable and returns SessionSummary[]", async () => {
    const sessions = await scanSessions(PROJECT_DIR);

    expect(sessions.length).toBeGreaterThan(0);

    const session: SessionSummary = sessions[0];
    expect(session.sessionId).toBeDefined();
    expect(typeof session.inputTokens).toBe("number");
    expect(typeof session.cost).toBe("number");
  });
});
