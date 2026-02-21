import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { scanSessions } from "../scan-sessions";

const FIXTURES = join(import.meta.dir, "fixtures");
const PROJECT_DIR = join(FIXTURES, "base-path", "-Users-foo-code-bar");
const FILTERING_PROJECT_DIR = join(
  FIXTURES,
  "filtering-base",
  "-Users-test-project",
);

describe("scanSessions", () => {
  it("returns one session from the fixture project dir", async () => {
    const sessions = await scanSessions(PROJECT_DIR);

    expect(sessions).toHaveLength(1);

    const session = sessions[0];
    expect(session.sessionId).toBe(
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
    expect(session.slug).toBeNull();
    expect(session.firstPrompt).toBe("What is 2+2?");
    expect(session.startedAt).toBe("2026-02-18T10:00:00.000Z");
    expect(session.lastActiveAt).toBe("2026-02-18T10:00:02.000Z");
  });

  it("silently returns empty for a missing project dir", async () => {
    const sessions = await scanSessions(
      join(FIXTURES, "does-not-exist"),
    );

    expect(sessions).toHaveLength(0);
  });

  it("silently returns empty for an empty project dir", async () => {
    const sessions = await scanSessions(FIXTURES);
    // fixtures/ contains only the base-path directory, no .jsonl files
    expect(sessions).toHaveLength(0);
  });

  describe("file & directory filtering", () => {
    it("skips directories inside the project dir", async () => {
      // filtering-base/-Users-test-project/ contains a subagent-companion/ dir
      const sessions = await scanSessions(FILTERING_PROJECT_DIR);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe(
        "11111111-1111-1111-1111-111111111111",
      );
    });

    it("skips non-.jsonl files", async () => {
      // filtering-base/-Users-test-project/ contains notes.txt
      const sessions = await scanSessions(FILTERING_PROJECT_DIR);
      const ids = sessions.map((s) => s.sessionId);
      expect(ids).not.toContain("notes");
      expect(sessions).toHaveLength(1);
    });

    it("skips files with non-UUID names", async () => {
      // filtering-base/-Users-test-project/ contains notes.jsonl and memory.jsonl
      const sessions = await scanSessions(FILTERING_PROJECT_DIR);
      const ids = sessions.map((s) => s.sessionId);
      expect(ids).not.toContain("notes");
      expect(ids).not.toContain("memory");
      expect(sessions).toHaveLength(1);
    });
  });
});
