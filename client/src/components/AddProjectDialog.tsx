import { useState, useMemo } from "react";
import { Folder, Loader2 } from "lucide-react";
import type { ProjectSummary } from "@/types/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectSummary[];
  loading: boolean;
  pinnedProjectIds: Set<string>;
  onSelectProject: (id: string) => void;
}

function projectDisplayName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function ProjectListItem({
  project,
  onSelect,
}: {
  project: ProjectSummary;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      onClick={() => onSelect(project.id)}
    >
      <Folder className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">
          {projectDisplayName(project.path)}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {project.path}
        </span>
      </span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        {project.sessionCount} {project.sessionCount === 1 ? "session" : "sessions"}
      </span>
    </button>
  );
}

export function AddProjectDialog({
  open,
  onOpenChange,
  projects,
  loading,
  pinnedProjectIds,
  onSelectProject,
}: AddProjectDialogProps) {
  const [search, setSearch] = useState("");

  const filteredProjects = useMemo(() => {
    const unpinned = projects.filter((p) => !pinnedProjectIds.has(p.id));
    if (!search.trim()) return unpinned;
    const query = search.toLowerCase();
    return unpinned.filter((p) => p.path.toLowerCase().includes(query));
  }, [projects, pinnedProjectIds, search]);

  const handleSelect = (id: string) => {
    onSelectProject(id);
    onOpenChange(false);
    setSearch("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
          <DialogDescription>
            Pin a project to your sidebar for quick access.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="-mx-2 flex-1 overflow-y-auto" style={{ maxHeight: "40vh" }}>
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && filteredProjects.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search.trim()
                ? "No matching projects"
                : "All projects are already pinned"}
            </p>
          )}
          {!loading &&
            filteredProjects.map((project) => (
              <ProjectListItem
                key={project.id}
                project={project}
                onSelect={handleSelect}
              />
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
