import { Plus, Search } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";

interface SearchTriggerProps {
  placeholder?: string;
  onClick: () => void;
  onAddProject?: () => void;
}

export function SearchTrigger({
  placeholder = "Search projects and sessions…",
  onClick,
  onAddProject,
}: SearchTriggerProps) {
  return (
    <div className="flex items-center gap-3">
      <InputGroup className="cursor-pointer" onClick={onClick}>
        <InputGroupAddon>
          <Search className="size-4" />
        </InputGroupAddon>
        <InputGroupInput
          readOnly
          placeholder={placeholder}
          className="pointer-events-none"
        />
        <InputGroupAddon align="inline-end">
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </InputGroupAddon>
      </InputGroup>
      {onAddProject && (
        <Button
          onClick={onAddProject}
          className="shrink-0"
        >
          <Plus className="mr-1.5 size-4" />
          Add Project
        </Button>
      )}
    </div>
  );
}
