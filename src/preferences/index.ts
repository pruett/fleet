import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export interface FleetPreferences {
  pinnedProjects: string[];
}

const DEFAULT_PREFERENCES: FleetPreferences = { pinnedProjects: [] };

export function getPreferencesPath(): string {
  return join(homedir(), ".config", "fleet", "settings.json");
}

export async function readPreferences(): Promise<FleetPreferences> {
  try {
    const file = Bun.file(getPreferencesPath());
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.pinnedProjects)
    ) {
      return parsed as FleetPreferences;
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
