import { useNavigate } from "react-router";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GroupedProject } from "@fleet/shared";

interface ProjectSelectorProps {
  projects: GroupedProject[];
  selectedSlug?: string;
  onAddProject?: () => void;
}

export function ProjectSelector({
  projects,
  selectedSlug,
  onAddProject,
}: ProjectSelectorProps) {
  const navigate = useNavigate();

  const selectedProject = selectedSlug
    ? projects.find((p) => p.slug === selectedSlug)
    : undefined;

  const label = selectedProject?.title ?? "All Projects";

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-1 text-sm text-foreground font-normal hover:text-foreground/80 transition-colors">
          {label}
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.slug}
                onSelect={() => navigate(`/projects/${project.slug}`)}
              >
                <span className="flex-1">{project.title}</span>
                {project.slug === selectedSlug && (
                  <Check className="ml-2 size-3.5 shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {onAddProject && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onAddProject}
                className="text-muted-foreground"
              >
                <Plus className="mr-2 size-3.5" />
                Add Project
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedProject && (
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
