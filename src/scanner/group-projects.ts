import type { ProjectSummary, GroupedProject } from "./types";
import type { ProjectConfig } from "../preferences";
import { slugify } from "../preferences";

/**
 * Group raw project directories into logical projects based on glob patterns.
 * For each ProjectConfig, matches raw projects whose `id` matches any of the
 * config's `projectDirs` glob patterns, then aggregates counts and timestamps.
 */
export function groupProjects(
  rawProjects: ProjectSummary[],
  configs: ProjectConfig[],
): GroupedProject[] {
  return configs.map((config) => {
    const globs = config.projectDirs.map((pattern) => new Bun.Glob(pattern));

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
      projectDirs: config.projectDirs,
      matchedDirIds: matched.map((p) => p.id),
      sessionCount,
      lastActiveAt,
    };
  });
}
