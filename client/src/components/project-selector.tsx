import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { GroupedProject } from "@fleet/shared";

interface ProjectSelectorProps {
  projects: GroupedProject[];
  selectedSlug?: string;
  onAddProject?: () => void;
  onRemoveProject?: (slug: string) => void;
  showClearButton?: boolean;
}

export function ProjectSelector({
  projects,
  selectedSlug,
  onAddProject,
  onRemoveProject,
  showClearButton = true,
}: ProjectSelectorProps) {
  const navigate = useNavigate();
  const [projectToRemove, setProjectToRemove] = useState<GroupedProject | null>(
    null,
  );

  const selectedProject = selectedSlug
    ? projects.find((p) => p.slug === selectedSlug)
    : undefined;

  const label = selectedProject?.title ?? "All Projects";

  function handleRemoveClick(e: React.MouseEvent, project: GroupedProject) {
    e.stopPropagation();
    e.preventDefault();
    setProjectToRemove(project);
  }

  function handleConfirmRemove() {
    if (!projectToRemove || !onRemoveProject) return;
    const wasSelected = projectToRemove.slug === selectedSlug;
    onRemoveProject(projectToRemove.slug);
    setProjectToRemove(null);
    if (wasSelected) {
      navigate("/");
    }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger className="group/trigger flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm text-foreground font-normal border border-transparent hover:bg-muted hover:border-border hover:text-accent-foreground data-[state=open]:bg-muted data-[state=open]:border-border data-[state=open]:text-accent-foreground transition-colors">
            <span className={selectedProject ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            <ChevronsUpDown className="size-4" strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="shadow-none">
            <DropdownMenuGroup>
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.slug}
                  className="group cursor-pointer"
                  onSelect={() => navigate(`/projects/${project.slug}`)}
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="flex-1">{project.title}</span>
                  {project.slug === selectedSlug && (
                    <Check className="ml-2 size-3.5 shrink-0" />
                  )}
                  {onRemoveProject && (
                    <button
                      type="button"
                      onClick={(e) => handleRemoveClick(e, project)}
                      className="ml-2 rounded-sm p-0.5 text-muted-foreground opacity-0 group-data-[highlighted]:opacity-100 hover:text-destructive transition-all"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {onAddProject && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onAddProject}
                  className="cursor-pointer text-muted-foreground"
                >
                  <Plus className="size-3.5" />
                  Add Project
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {selectedProject && showClearButton && (
          <button
            type="button"
            onClick={() => navigate("/")}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <Dialog
        open={projectToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setProjectToRemove(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove project</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{" "}
              <span className="font-medium text-foreground">
                {projectToRemove?.title}
              </span>
              ? This will remove it from your project list. Session data will not
              be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProjectToRemove(null)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmRemove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
