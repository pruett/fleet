export const queryKeys = {
  projects: () => ["projects"] as const,
  config: () => ["config"] as const,
  directories: () => ["directories"] as const,
  sessionsAll: () => ["sessions"] as const,
  sessions: (slug: string, limit?: number) =>
    limit !== undefined
      ? (["sessions", slug, limit] as const)
      : (["sessions", slug] as const),
  sessionsPrefix: (slug: string) => ["sessions", slug] as const,
};
