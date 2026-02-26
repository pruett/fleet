export const queryKeys = {
  projects: () => ["projects"] as const,
  preferences: () => ["preferences"] as const,
  directories: () => ["directories"] as const,
  sessions: (slug: string, limit?: number) =>
    limit !== undefined
      ? (["sessions", slug, limit] as const)
      : (["sessions", slug] as const),
  sessionsPrefix: (slug: string) => ["sessions", slug] as const,
  worktrees: (slug: string) => ["worktrees", slug] as const,
};
