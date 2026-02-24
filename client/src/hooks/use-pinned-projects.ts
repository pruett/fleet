import { useCallback, useEffect, useState } from "react";
import {
  fetchPreferences,
  fetchProjects,
  updatePreferences,
} from "@/lib/api";
import type { ProjectSummary, FleetPreferences } from "@/types/api";

export interface UsePinnedProjectsResult {
  /** Projects matching pinned IDs, in pin order */
  pinnedProjects: ProjectSummary[];
  /** Set of currently pinned project IDs */
  pinnedIds: Set<string>;
  /** Full list of all discovered projects */
  allProjects: ProjectSummary[];
  /** True while initial data is loading */
  loading: boolean;
  /** True while allProjects is being refreshed */
  loadingAllProjects: boolean;
  /** Add a project to the pinned list */
  pinProject: (id: string) => void;
  /** Remove a project from the pinned list */
  unpinProject: (id: string) => void;
  /** Re-fetch the full project list (e.g. when opening the dialog) */
  refreshAllProjects: () => Promise<void>;
}

export function usePinnedProjects(): UsePinnedProjectsResult {
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAllProjects, setLoadingAllProjects] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPreferences(), fetchProjects()])
      .then(([prefs, projects]) => {
        if (cancelled) return;
        setPinnedIds(prefs.pinnedProjects);
        setAllProjects(projects);
      })
      .catch(() => {
        // silently handle — empty state is fine
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistPinnedIds = useCallback(
    (nextIds: string[]) => {
      setPinnedIds(nextIds);
      const prefs: FleetPreferences = { pinnedProjects: nextIds };
      updatePreferences(prefs).catch(() => {
        // Rollback on failure — re-fetch from server
        fetchPreferences()
          .then((p) => setPinnedIds(p.pinnedProjects))
          .catch(() => {});
      });
    },
    [],
  );

  const pinProject = useCallback(
    (id: string) => {
      setPinnedIds((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        persistPinnedIds(next);
        return next;
      });
    },
    [persistPinnedIds],
  );

  const unpinProject = useCallback(
    (id: string) => {
      setPinnedIds((prev) => {
        const next = prev.filter((pid) => pid !== id);
        persistPinnedIds(next);
        return next;
      });
    },
    [persistPinnedIds],
  );

  const refreshAllProjects = useCallback(async () => {
    setLoadingAllProjects(true);
    try {
      const projects = await fetchProjects();
      setAllProjects(projects);
    } catch {
      // silently handle
    } finally {
      setLoadingAllProjects(false);
    }
  }, []);

  // Derive pinned projects from IDs × full list, preserving pin order
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));
  const pinnedProjects = pinnedIds
    .map((id) => projectMap.get(id))
    .filter((p): p is ProjectSummary => p !== undefined);

  return {
    pinnedProjects,
    pinnedIds: new Set(pinnedIds),
    allProjects,
    loading,
    loadingAllProjects,
    pinProject,
    unpinProject,
    refreshAllProjects,
  };
}
