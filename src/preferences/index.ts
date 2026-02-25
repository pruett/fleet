import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export interface ProjectConfig {
  title: string;
  projectDirs: string[];
}

export interface FleetPreferences {
  projects: ProjectConfig[];
}

const DEFAULT_PREFERENCES: FleetPreferences = { projects: [] };

/**
 * Convert a title to a URL-safe slug.
 * Lowercase, replace non-alphanumeric runs with a single dash, trim dashes.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getPreferencesPath(): string {
  return join(homedir(), ".config", "fleet", "settings.json");
}

/**
 * Migrate legacy `{ pinnedProjects: string[] }` format to the new
 * `{ projects: ProjectConfig[] }` format. Each pinned ID becomes an
 * exact-match pattern with a title derived from the last path segment.
 */
function migrateLegacy(parsed: Record<string, unknown>): FleetPreferences {
  const ids = parsed.pinnedProjects as string[];
  const projects: ProjectConfig[] = ids.map((id) => {
    // Decode the dir name to a path, then take the last segment as title
    const decoded = id.replaceAll("-", "/");
    const title =
      decoded.split("/").filter(Boolean).pop() ?? id;
    return { title, projectDirs: [id] };
  });
  return { projects };
}

export async function readPreferences(): Promise<FleetPreferences> {
  try {
    const file = Bun.file(getPreferencesPath());
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_PREFERENCES;
    }
    // New format
    if (Array.isArray(parsed.projects)) {
      return { projects: parsed.projects } as FleetPreferences;
    }
    // Legacy format — migrate
    if (Array.isArray(parsed.pinnedProjects)) {
      return migrateLegacy(parsed);
    }
    return DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function writePreferences(
  prefs: FleetPreferences,
): Promise<void> {
  const filePath = getPreferencesPath();
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(prefs, null, 2) + "\n");
}
