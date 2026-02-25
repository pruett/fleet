import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { scanWorktrees } from "../scan-worktrees";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("scanWorktrees", () => {
  it("returns worktree directories from .claude/.worktrees/", async () => {
    const worktrees = await scanWorktrees(
      join(FIXTURES, "worktree-project"),
    );

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].name).toBe("feat-dark-mode");
    expect(worktrees[0].path).toBe(
      join(FIXTURES, "worktree-project", ".claude", ".worktrees", "feat-dark-mode"),
    );
    expect(worktrees[1].name).toBe("fix-auth-bug");
    expect(worktrees[1].path).toBe(
      join(FIXTURES, "worktree-project", ".claude", ".worktrees", "fix-auth-bug"),
    );
  });

  it("skips non-directory entries in .worktrees/", async () => {
    // worktree-project/.claude/.worktrees/ contains some-file.txt
    const worktrees = await scanWorktrees(
      join(FIXTURES, "worktree-project"),
    );
    const names = worktrees.map((w) => w.name);
    expect(names).not.toContain("some-file.txt");
    expect(worktrees).toHaveLength(2);
  });

  it("returns empty array when .claude/.worktrees/ is empty", async () => {
    const worktrees = await scanWorktrees(
      join(FIXTURES, "worktree-project-empty"),
    );
    expect(worktrees).toHaveLength(0);
  });

  it("returns empty array when .claude/ directory does not exist", async () => {
    const worktrees = await scanWorktrees(
      join(FIXTURES, "worktree-project-no-claude"),
    );
    expect(worktrees).toHaveLength(0);
  });

  it("returns empty array for a nonexistent project path", async () => {
    const worktrees = await scanWorktrees(
      join(FIXTURES, "does-not-exist"),
    );
    expect(worktrees).toHaveLength(0);
  });

  it("returns worktrees sorted alphabetically by name", async () => {
    const worktrees = await scanWorktrees(
      join(FIXTURES, "worktree-project"),
    );

    expect(worktrees[0].name).toBe("feat-dark-mode");
    expect(worktrees[1].name).toBe("fix-auth-bug");
  });
});
