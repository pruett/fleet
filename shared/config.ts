export interface ProjectConfig {
  title: string;
  projectIds: string[];
  color: string;
}

export interface FleetConfig {
  projects: ProjectConfig[];
}

/**
 * 12 visually distinct colors for auto-assigning to projects.
 * Ordered to maximize contrast between adjacent assignments.
 */
export const PROJECT_COLORS = [
  "#E05252", // red
  "#2D8CFF", // blue
  "#16A34A", // green
  "#E89E18", // amber
  "#8B5CF6", // violet
  "#0D9488", // teal
  "#EC4899", // pink
  "#EA580C", // orange
  "#6366F1", // indigo
  "#CA8A04", // yellow
  "#0EA5E9", // sky
  "#D946EF", // fuchsia
] as const;

/**
 * Pick the next project color by cycling through the palette.
 * Uses the count of existing projects to index into the array.
 */
export function getNextProjectColor(existingProjects: ProjectConfig[]): string {
  return PROJECT_COLORS[existingProjects.length % PROJECT_COLORS.length];
}
