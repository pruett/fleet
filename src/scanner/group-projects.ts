import type { ProjectSummary, GroupedProject, ProjectConfig } from "@fleet/shared";
import { slugify } from "../config";

/**
 * Group raw project directories into logical projects based on glob patterns.
 * For each ProjectConfig, matches raw projects whose `id` matches any of the
 * config's `projectIds` glob patterns, then aggregates counts and timestamps.
 */
export function groupProjects(
  rawProjects: ProjectSummary[],
  configs: ProjectConfig[],
): GroupedProject[] {
  return configs.map((config) => {
    const globs = config.projectIds.map((pattern) => new Bun.Glob(pattern));

    const matched = rawProjects.filter((p) =>
      globs.some((g) => g.match(p.id)),
    );

    const sessionCount = matched.reduce((sum, p) => sum + p.sessionCount, 0);

    const lastActiveAt = matched.reduce<string | null>((max, p) => {
      if (!p.lastActiveAt) return max;
      if (!max) return p.lastActiveAt;
      return p.lastActiveAt > max ? p.lastActiveAt : max;
    }, null);

    return {
      slug: slugify(config.title),
      title: config.title,
      projectIds: config.projectIds,
      matchedDirIds: matched.map((p) => p.id),
      sessionCount,
      lastActiveAt,
    };
  });
}
