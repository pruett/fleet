import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPreferences,
  fetchProjects,
  fetchDirectories,
  updatePreferences,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
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
  const qc = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: fetchProjects,
  });

  const preferencesQuery = useQuery({
    queryKey: queryKeys.preferences(),
    queryFn: fetchPreferences,
  });

  const directoriesQuery = useQuery({
    queryKey: queryKeys.directories(),
    queryFn: fetchDirectories,
    enabled: false, // only fetched on demand via refreshDirectories
  });

  const mutation = useMutation({
    mutationFn: async (nextConfigs: ProjectConfig[]) => {
      const prefs: FleetPreferences = { projects: nextConfigs };
      await updatePreferences(prefs);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects() });
      qc.invalidateQueries({ queryKey: queryKeys.preferences() });
    },
  });

  const configs = preferencesQuery.data?.projects ?? [];

  const addProject = useCallback(
    (config: ProjectConfig) => {
      mutation.mutate([...configs, config]);
    },
    [configs, mutation],
  );

  const removeProject = useCallback(
    (slug: string) => {
      const next = configs.filter((c) => slugify(c.title) !== slug);
      mutation.mutate(next);
    },
    [configs, mutation],
  );

  const refreshDirectories = useCallback(async () => {
    await directoriesQuery.refetch();
  }, [directoriesQuery]);

  const projects = projectsQuery.data ?? [];
  const projectSlugs = useMemo(
    () => new Set(projects.map((p) => p.slug)),
    [projects],
  );

  return {
    projects,
    projectSlugs,
    allDirectories: directoriesQuery.data ?? [],
    loading: projectsQuery.isLoading || preferencesQuery.isLoading,
    loadingDirectories: directoriesQuery.isFetching,
    addProject,
    removeProject,
    refreshDirectories,
  };
}
