import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export type { ProjectConfig, FleetConfig } from "@fleet/shared";
import type { ProjectConfig, FleetConfig } from "@fleet/shared";

const DEFAULT_CONFIG: FleetConfig = { projects: [] };

export { slugify } from "@fleet/shared";

export function getConfigPath(): string {
  return join(homedir(), ".config", "fleet", "settings.json");
}

/**
 * Migrate legacy `{ pinnedProjects: string[] }` format to the new
 * `{ projects: ProjectConfig[] }` format. Each pinned ID becomes an
 * exact-match pattern with a title derived from the last path segment.
 */
function migrateLegacy(parsed: Record<string, unknown>): FleetConfig {
  const ids = parsed.pinnedProjects as string[];
  const projects: ProjectConfig[] = ids.map((id) => {
    // Decode the dir name to a path, then take the last segment as title
    const decoded = id.replaceAll("-", "/");
    const title =
      decoded.split("/").filter(Boolean).pop() ?? id;
    return { title, projectIds: [id] };
  });
  return { projects };
}

export async function readConfig(): Promise<FleetConfig> {
  try {
    const file = Bun.file(getConfigPath());
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_CONFIG;
    }
    // New format
    if (Array.isArray(parsed.projects)) {
      return { projects: parsed.projects } as FleetConfig;
    }
    // Legacy format — migrate
    if (Array.isArray(parsed.pinnedProjects)) {
      return migrateLegacy(parsed);
    }
    return DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function writeConfig(
  config: FleetConfig,
): Promise<void> {
  const filePath = getConfigPath();
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(config, null, 2) + "\n");
}
