import { describe, expect, it } from "bun:test";
import { parseWorktreeListOutput, scanWorktrees } from "../scan-worktrees";

// ---------------------------------------------------------------------------
// Helper: create a mock exec function
// ---------------------------------------------------------------------------

function mockExec(stdout: string) {
  return async () => ({ stdout });
}

function failingExec(error: Error) {
  return async () => {
    throw error;
  };
}

// ---------------------------------------------------------------------------
// parseWorktreeListOutput — pure function tests
// ---------------------------------------------------------------------------

describe("parseWorktreeListOutput", () => {
  it("parses multiple linked worktrees", () => {
    const output = [
      "worktree /Users/me/project",
      "HEAD abc1234",
      "branch refs/heads/main",
      "",
      "worktree /Users/me/project/.worktrees/feat-dark-mode",
      "HEAD def5678",
      "branch refs/heads/feat/dark-mode",
      "",
      "worktree /Users/me/project/.worktrees/fix-auth-bug",
      "HEAD 9ab0cde",
      "branch refs/heads/fix/auth-bug",
    ].join("\n");

    const result = parseWorktreeListOutput(output);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "feat-dark-mode",
      path: "/Users/me/project/.worktrees/feat-dark-mode",
      branch: "feat/dark-mode",
    });
    expect(result[1]).toEqual({
      name: "fix-auth-bug",
      path: "/Users/me/project/.worktrees/fix-auth-bug",
      branch: "fix/auth-bug",
    });
  });

  it("handles detached HEAD (no branch line)", () => {
    const output = [
      "worktree /Users/me/project",
      "HEAD abc1234",
      "branch refs/heads/main",
      "",
      "worktree /Users/me/project/.worktrees/explore-perf",
      "HEAD def5678",
      "detached",
    ].join("\n");

    const result = parseWorktreeListOutput(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "explore-perf",
      path: "/Users/me/project/.worktrees/explore-perf",
      branch: null,
    });
  });

  it("filters out main worktree (first block)", () => {
    const output = [
      "worktree /Users/me/project",
      "HEAD abc1234",
      "branch refs/heads/main",
    ].join("\n");

    const result = parseWorktreeListOutput(output);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty output", () => {
    expect(parseWorktreeListOutput("")).toHaveLength(0);
    expect(parseWorktreeListOutput("  \n  ")).toHaveLength(0);
  });

  it("handles worktrees at arbitrary paths", () => {
    const output = [
      "worktree /Users/me/project",
      "HEAD abc1234",
      "branch refs/heads/main",
      "",
      "worktree /tmp/my-worktree",
      "HEAD def5678",
      "branch refs/heads/feature/some-thing",
    ].join("\n");

    const result = parseWorktreeListOutput(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "my-worktree",
      path: "/tmp/my-worktree",
      branch: "feature/some-thing",
    });
  });
});

// ---------------------------------------------------------------------------
// scanWorktrees — integration tests with injected exec
// ---------------------------------------------------------------------------

describe("scanWorktrees", () => {
  it("returns parsed worktrees sorted alphabetically", async () => {
    const exec = mockExec(
      [
        "worktree /Users/me/project",
        "HEAD abc1234",
        "branch refs/heads/main",
        "",
        "worktree /Users/me/project/.worktrees/fix-auth-bug",
        "HEAD 9ab0cde",
        "branch refs/heads/fix/auth-bug",
        "",
        "worktree /Users/me/project/.worktrees/feat-dark-mode",
        "HEAD def5678",
        "branch refs/heads/feat/dark-mode",
      ].join("\n"),
    );

    const result = await scanWorktrees("/Users/me/project", exec);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("feat-dark-mode");
    expect(result[0].branch).toBe("feat/dark-mode");
    expect(result[1].name).toBe("fix-auth-bug");
    expect(result[1].branch).toBe("fix/auth-bug");
  });

  it("returns empty array when only main worktree exists", async () => {
    const exec = mockExec(
      [
        "worktree /Users/me/project",
        "HEAD abc1234",
        "branch refs/heads/main",
      ].join("\n"),
    );

    const result = await scanWorktrees("/Users/me/project", exec);
    expect(result).toHaveLength(0);
  });

  it("returns empty array on git command failure", async () => {
    const exec = failingExec(new Error("not a git repository"));

    const result = await scanWorktrees("/not/a/git/repo", exec);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when git is not installed", async () => {
    const exec = failingExec(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const result = await scanWorktrees("/Users/me/project", exec);
    expect(result).toHaveLength(0);
  });

  it("includes branch as null for detached HEAD worktrees", async () => {
    const exec = mockExec(
      [
        "worktree /Users/me/project",
        "HEAD abc1234",
        "branch refs/heads/main",
        "",
        "worktree /Users/me/project/.worktrees/explore-1",
        "HEAD def5678",
        "detached",
      ].join("\n"),
    );

    const result = await scanWorktrees("/Users/me/project", exec);

    expect(result).toHaveLength(1);
    expect(result[0].branch).toBeNull();
    expect(result[0].name).toBe("explore-1");
  });

  it("uses default exec when none provided", async () => {
    // Call without injected exec — should not throw, just returns [] for non-git dir
    const result = await scanWorktrees("/tmp/definitely-not-a-git-repo");
    expect(result).toEqual([]);
  });
});
