import { ProjectSelector } from "@/components/project-selector";
import type { GroupedProject } from "@fleet/shared";

interface HeaderProps {
  projects?: GroupedProject[];
  selectedSlug?: string;
  onAddProject?: () => void;
  onRemoveProject?: (slug: string) => void;
  showClearButton?: boolean;
  rightContent?: React.ReactNode;
}

export function Header({ projects, selectedSlug, onAddProject, onRemoveProject, showClearButton, rightContent }: HeaderProps) {
  return (
    <header className="border-b bg-muted/40 px-6 py-4">
      <div className="flex items-center">
        {/* Left – project selector */}
        <div className="flex-1">
          {projects && <ProjectSelector projects={projects} selectedSlug={selectedSlug} onAddProject={onAddProject} onRemoveProject={onRemoveProject} showClearButton={showClearButton} />}
        </div>

        {/* Center – title */}
        <span className="text-sm font-medium">fleet</span>

        {/* Right */}
        <div className="flex-1 flex justify-end">{rightContent}</div>
      </div>
    </header>
  );
}
