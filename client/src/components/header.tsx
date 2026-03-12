import { Plus, Search, Ship } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectSelector } from "@/components/project-selector";
import type { GroupedProject } from "@fleet/shared";

interface HeaderProps {
  projects?: GroupedProject[];
  selectedSlug?: string;
  onAddProject?: () => void;
  onRemoveProject?: (slug: string) => void;
  onSearch?: () => void;
  showClearButton?: boolean;
  rightContent?: React.ReactNode;
}

export function Header({ projects, selectedSlug, onAddProject, onRemoveProject, onSearch, showClearButton, rightContent }: HeaderProps) {
  return (
    <header className="border-b px-6 py-4">
      <div className="flex items-center">
        {/* Left – project selector */}
        <div className="flex-1">
          {projects && <ProjectSelector projects={projects} selectedSlug={selectedSlug} onAddProject={onAddProject} onRemoveProject={onRemoveProject} showClearButton={showClearButton} />}
        </div>

        {/* Center – title */}
        <div className="flex flex-col items-center gap-1.5">
          <Ship className="size-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs font-normal text-muted-foreground font-mono font-medium">fleet</span>
        </div>

        {/* Right */}
        <div className="flex-1 flex items-center justify-end gap-2">
          {rightContent}
          {onSearch && (
            <Button variant="outline" size="sm" className="shadow-none" onClick={onSearch}>
              <Search data-icon="inline-start" />
              Search
              <kbd className="ml-1 inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>
          )}
          {onAddProject && (
            <Button variant="outline" size="sm" className="hidden lg:inline-flex shadow-none" onClick={onAddProject}>
              <Plus data-icon="inline-start" />
              Add Project
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
