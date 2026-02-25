import { useCallback, useEffect, useState } from "react";
import {
  fetchPreferences,
  fetchProjects,
  fetchDirectories,
  updatePreferences,
} from "@/lib/api";
import type {
  GroupedProject,
  ProjectSummary,
  ProjectConfig,
  FleetPreferences,
} from "@/types/api";

export interface UseProjectsResult {
  projects: GroupedProject[];
  projectSlugs: Set<string>;
  allDirectories: ProjectSummary[];
  loading: boolean;
  loadingDirectories: boolean;
  addProject: (config: ProjectConfig) => void;
  removeProject: (slug: string) => void;
  refreshDirectories: () => Promise<void>;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<GroupedProject[]>([]);
  const [configs, setConfigs] = useState<ProjectConfig[]>([]);
  const [allDirectories, setAllDirectories] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDirectories, setLoadingDirectories] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchProjects(), fetchPreferences()])
      .then(([grouped, prefs]) => {
        if (cancelled) return;
        setProjects(grouped);
        setConfigs(prefs.projects);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistAndRefresh = useCallback(
    async (nextConfigs: ProjectConfig[]) => {
      setConfigs(nextConfigs);
      const prefs: FleetPreferences = { projects: nextConfigs };
      try {
        await updatePreferences(prefs);
        const grouped = await fetchProjects();
        setProjects(grouped);
      } catch {
        // Rollback on failure
        const serverPrefs = await fetchPreferences().catch(() => ({
          projects: [],
        }));
        setConfigs(serverPrefs.projects);
        const grouped = await fetchProjects().catch(() => []);
        setProjects(grouped);
      }
    },
    [],
  );

  const addProject = useCallback(
    (config: ProjectConfig) => {
      const next = [...configs, config];
      persistAndRefresh(next);
    },
    [configs, persistAndRefresh],
  );

  const removeProject = useCallback(
    (slug: string) => {
      const next = configs.filter((c) => slugify(c.title) !== slug);
      persistAndRefresh(next);
    },
    [configs, persistAndRefresh],
  );

  const refreshDirectories = useCallback(async () => {
    setLoadingDirectories(true);
    try {
      const dirs = await fetchDirectories();
      setAllDirectories(dirs);
    } catch {
      // silently handle
    } finally {
      setLoadingDirectories(false);
    }
  }, []);

  const projectSlugs = new Set(projects.map((p) => p.slug));

  return {
    projects,
    projectSlugs,
    allDirectories,
    loading,
    loadingDirectories,
    addProject,
    removeProject,
    refreshDirectories,
  };
}
