import { useState, useMemo, useCallback } from "react";
import { ArrowLeft, Folder, Loader2 } from "lucide-react";
import type { ProjectSummary, ProjectConfig } from "@/types/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directories: ProjectSummary[];
  loading: boolean;
  existingSlugs: Set<string>;
  onAddProject: (config: ProjectConfig) => void;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Check if a directory name looks like a worktree variant. */
function isWorktreeDir(dirName: string): boolean {
  return dirName.includes("--claude--worktrees-");
}

/**
 * Extract a "root" key from a directory name by stripping worktree suffixes.
 * e.g. "-Users-foo-code-fleet" and "-Users-foo-code-fleet--claude--worktrees-feat-xyz"
 * both map to "-Users-foo-code-fleet".
 */
function rootKey(dirName: string): string {
  const idx = dirName.indexOf("--claude--worktrees-");
  return idx === -1 ? dirName : dirName.slice(0, idx);
}

function projectDisplayName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

interface RootEntry {
  rootId: string;
  path: string;
  displayName: string;
  worktreeCount: number;
  totalSessions: number;
}

export function AddProjectDialog({
  open,
  onOpenChange,
  directories,
  loading,
  existingSlugs,
  onAddProject,
}: AddProjectDialogProps) {
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<"browse" | "configure">("browse");
  const [title, setTitle] = useState("");
  const [pattern, setPattern] = useState("");

  // Group directories by root, filtering out already-added projects
  const roots = useMemo(() => {
    const grouped = new Map<
      string,
      { root: ProjectSummary; worktreeCount: number; totalSessions: number }
    >();

    for (const dir of directories) {
      const key = rootKey(dir.id);
      const existing = grouped.get(key);
      if (!existing) {
        // Use the root dir itself if it's not a worktree, otherwise create a synthetic root
        const isWt = isWorktreeDir(dir.id);
        grouped.set(key, {
          root: isWt ? { ...dir, id: key, path: key.replaceAll("-", "/") } : dir,
          worktreeCount: isWt ? 1 : 0,
          totalSessions: dir.sessionCount,
        });
      } else {
        if (isWorktreeDir(dir.id)) {
          existing.worktreeCount++;
        }
        existing.totalSessions += dir.sessionCount;
      }
    }

    const entries: RootEntry[] = [];
    for (const [key, { root, worktreeCount, totalSessions }] of grouped) {
      const slug = slugify(projectDisplayName(root.path));
      if (existingSlugs.has(slug)) continue;
      entries.push({
        rootId: key,
        path: root.path,
        displayName: projectDisplayName(root.path),
        worktreeCount,
        totalSessions,
      });
    }

    if (!search.trim()) return entries;
    const query = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.displayName.toLowerCase().includes(query) ||
        e.path.toLowerCase().includes(query),
    );
  }, [directories, existingSlugs, search]);

  // Count matching directories for the current pattern
  const matchCount = useMemo(() => {
    if (!pattern.trim()) return 0;
    try {
      const re = globToRegExp(pattern);
      return directories.filter((d) => re.test(d.id)).length;
    } catch {
      return 0;
    }
  }, [directories, pattern]);

  const handleSelectRoot = useCallback((root: RootEntry) => {
    setTitle(root.displayName);
    setPattern(`${root.rootId}*`);
    setStep("configure");
    setSearch("");
  }, []);

  const handleSave = useCallback(() => {
    if (!title.trim() || !pattern.trim()) return;
    onAddProject({ title: title.trim(), projectDirs: [pattern.trim()] });
    handleClose();
  }, [title, pattern, onAddProject]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    // Reset after close animation
    setTimeout(() => {
      setStep("browse");
      setSearch("");
      setTitle("");
      setPattern("");
    }, 200);
  }, [onOpenChange]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose();
    } else {
      onOpenChange(true);
    }
  };

  const canSave =
    title.trim().length > 0 &&
    pattern.trim().length > 0 &&
    !existingSlugs.has(slugify(title.trim()));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-md">
        {step === "browse" ? (
          <>
            <DialogHeader>
              <DialogTitle>Add Project</DialogTitle>
              <DialogDescription>
                Select a project root to group its directories.
              </DialogDescription>
            </DialogHeader>
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <div
              className="-mx-2 flex-1 overflow-y-auto"
              style={{ maxHeight: "40vh" }}
            >
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loading && roots.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {search.trim()
                    ? "No matching projects"
                    : "All projects are already added"}
                </p>
              )}
              {!loading &&
                roots.map((root) => (
                  <button
                    key={root.rootId}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() => handleSelectRoot(root)}
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">
                        {root.displayName}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {root.path}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {root.worktreeCount > 0
                        ? `${root.worktreeCount + 1} dirs`
                        : `${root.totalSessions} ${root.totalSessions === 1 ? "session" : "sessions"}`}
                    </span>
                  </button>
                ))}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    setStep("browse");
                    setSearch("");
                  }}
                >
                  <ArrowLeft className="size-4" />
                </button>
                <div>
                  <DialogTitle>Configure Project</DialogTitle>
                  <DialogDescription>
                    Set the title and glob pattern for this project group.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="project-title">
                  Title
                </label>
                <Input
                  id="project-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. fleet"
                  autoFocus
                />
                {title.trim() && existingSlugs.has(slugify(title.trim())) && (
                  <p className="text-xs text-destructive">
                    A project with this name already exists.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-sm font-medium"
                  htmlFor="project-pattern"
                >
                  Directory pattern
                </label>
                <Input
                  id="project-pattern"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="e.g. -Users-foo-code-fleet*"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Matches {matchCount}{" "}
                  {matchCount === 1 ? "directory" : "directories"}
                </p>
              </div>
              <Button onClick={handleSave} disabled={!canSave} className="mt-1">
                Add Project
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Convert a simple glob pattern (supporting only `*`) to a RegExp.
 * This avoids needing a glob library on the client side.
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcard = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${withWildcard}$`);
}
