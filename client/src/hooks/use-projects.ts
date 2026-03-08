import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchConfig,
  fetchProjects,
  fetchDirectories,
  updateConfig,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { slugify } from "@fleet/shared";
import type {
  GroupedProject,
  ProjectSummary,
  ProjectConfig,
  FleetConfig,
} from "@fleet/shared";

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

export function useProjects(): UseProjectsResult {
  const qc = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: fetchProjects,
  });

  const configQuery = useQuery({
    queryKey: queryKeys.config(),
    queryFn: fetchConfig,
  });

  const directoriesQuery = useQuery({
    queryKey: queryKeys.directories(),
    queryFn: fetchDirectories,
    enabled: false, // only fetched on demand via refreshDirectories
  });

  const mutation = useMutation({
    mutationFn: (config: FleetConfig) => updateConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.config() });
      qc.invalidateQueries({ queryKey: queryKeys.projects() });
    },
  });

  const configs = useMemo(
    () => configQuery.data?.projects ?? [],
    [configQuery.data?.projects],
  );

  const addProject = useCallback(
    (project: ProjectConfig) => {
      mutation.mutate({ projects: [...configs, project] });
    },
    [configs, mutation],
  );

  const removeProject = useCallback(
    (slug: string) => {
      const next = configs.filter((c) => slugify(c.title) !== slug);
      mutation.mutate({ projects: next });
    },
    [configs, mutation],
  );

  const refreshDirectories = useCallback(async () => {
    await directoriesQuery.refetch();
  }, [directoriesQuery]);

  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );
  const projectSlugs = useMemo(
    () => new Set(projects.map((p) => p.slug)),
    [projects],
  );

  return {
    projects,
    projectSlugs,
    allDirectories: directoriesQuery.data ?? [],
    loading: projectsQuery.isLoading || configQuery.isLoading,
    loadingDirectories: directoriesQuery.isFetching,
    addProject,
    removeProject,
    refreshDirectories,
  };
}
