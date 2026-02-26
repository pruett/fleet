import type {
  AssistantBlockMessage,
  ParsedMessage,
  ProgressAgentMessage,
  ProgressBashMessage,
  SystemApiErrorMessage,
  SystemTurnDurationMessage,
  UserPromptMessage,
  UserToolResultMessage,
} from "@/types/api";
import { cn } from "@/lib/utils";
import { HighlightedCode } from "./HighlightedCode";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useCollapsibleState } from "./CollapsibleGroup";

// ---------------------------------------------------------------------------
// ChevronIcon — rotates to indicate open/closed state
// ---------------------------------------------------------------------------

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 transition-transform duration-150",
        open && "rotate-90",
      )}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Visibility filter
// ---------------------------------------------------------------------------

const HIDDEN_KINDS = new Set<string>([
  "file-history-snapshot",
  "queue-operation",
  "system-local-command",
  "progress-hook",
]);

/** Detect user prompts that are mostly XML tags (slash-command output, etc.). */
function isXmlTagMessage(text: string): boolean {
  const trimmed = text.trim();
  return /^<[a-z-]+[\s>]/i.test(trimmed) && /<\/[a-z-]+>\s*$/i.test(trimmed);
}

/** Determine whether a message should be rendered in the conversation. */
// eslint-disable-next-line react-refresh/only-export-components
export function isVisibleMessage(message: ParsedMessage): boolean {
  if (HIDDEN_KINDS.has(message.kind)) return false;
  if (message.kind === "user-prompt" && message.isMeta) return false;
  if (message.kind === "user-prompt" && isXmlTagMessage(message.text)) return false;
  if (message.kind === "malformed") return false; // debug mode only (Phase 5)
  return true;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

interface MessageComponentProps {
  message: ParsedMessage;
}

/**
 * Renders the appropriate block for a ParsedMessage based on its `kind`.
 * Hidden kinds and meta prompts return null.
 */
export function MessageComponent({ message }: MessageComponentProps) {
  switch (message.kind) {
    case "file-history-snapshot":
    case "queue-operation":
    case "system-local-command":
    case "progress-hook":
      return null;

    case "user-prompt":
      if (message.isMeta) return null;
      return <UserPromptBubble message={message} />;

    case "assistant-block":
      switch (message.contentBlock.type) {
        case "text":
          return <AssistantTextBlock message={message} />;
        case "thinking":
          return <ThinkingBlock message={message} />;
        case "tool_use":
          return null;
      }
      return null;

    case "user-tool-result":
      return null;

    case "system-api-error":
      return <ApiErrorBlock message={message} />;

    case "system-turn-duration":
      return null;

    case "progress-bash":
      return <BashProgressBlock message={message} />;

    case "progress-agent":
      return <AgentProgressBlock message={message} />;

    case "malformed":
      return null;
  }
}

// ---------------------------------------------------------------------------
// UserPromptBubble
// ---------------------------------------------------------------------------

function UserPromptBubble({ message }: { message: UserPromptMessage }) {
  return (
    <div>
      <div className="rounded-2xl border bg-white px-4 py-2.5 shadow-sm dark:bg-zinc-900">
        <p className="whitespace-pre-wrap text-base">{message.text}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssistantTextBlock
// ---------------------------------------------------------------------------

function AssistantTextBlock({ message }: { message: AssistantBlockMessage }) {
  const text =
    message.contentBlock.type === "text" ? message.contentBlock.text : "";
  return (
    <div>
      <MarkdownRenderer content={text} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThinkingBlock — collapsed by default, monospace text
// ---------------------------------------------------------------------------

function ThinkingBlock({ message }: { message: AssistantBlockMessage }) {
  const thinking =
    message.contentBlock.type === "thinking"
      ? message.contentBlock.thinking
      : "";
  const [open, setOpen] = useCollapsibleState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ChevronIcon open={open} />
        Thinking
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-1">
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {thinking}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// ToolUseBlock — tool name header + collapsible JSON input
// ---------------------------------------------------------------------------

function ToolUseBlock({ message }: { message: AssistantBlockMessage }) {
  const [open, setOpen] = useCollapsibleState(false);
  if (message.contentBlock.type !== "tool_use") return null;
  const { name, input } = message.contentBlock;
  const jsonString = JSON.stringify(input, null, 2);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-sm font-medium">
        <ChevronIcon open={open} />
        {name}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t px-3 py-2">
          <div className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded p-2 text-xs [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-0">
            <HighlightedCode code={jsonString} lang="json" />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// ToolResultBlock — collapsible if >= 10 lines, first 5 as preview
// ---------------------------------------------------------------------------

function ToolResultBlock({ message }: { message: UserToolResultMessage }) {
  return (
    <div className="space-y-1">
      {message.results.map((result) => (
        <ToolResultItem key={result.toolUseId} result={result} />
      ))}
    </div>
  );
}

function ToolResultItem({
  result,
}: {
  result: UserToolResultMessage["results"][number];
}) {
  const text =
    typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content, null, 2);
  const lines = text.split("\n");
  const isLong = lines.length >= 10;

  // Long results default to collapsed; short results are always open
  const [open, setOpen] = useCollapsibleState(!isLong);

  if (isLong) {
    return (
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className={cn(
          "rounded border p-2",
          result.isError ? "border-destructive/50" : "border-muted",
        )}
      >
        <CollapsibleTrigger
          className={cn(
            "flex w-full cursor-pointer select-none items-center gap-1.5 text-xs font-medium",
            result.isError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <ChevronIcon open={open} />
          Tool Result{result.isError ? " (Error)" : ""} — {lines.length} lines
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
            {text}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div
      className={cn(
        "rounded border p-2",
        result.isError ? "border-destructive/50" : "border-muted",
      )}
    >
      <span
        className={cn(
          "mb-1 block text-xs font-medium",
          result.isError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        Tool Result{result.isError ? " (Error)" : ""}
      </span>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs">
        {text}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApiErrorBlock — red error banner
// ---------------------------------------------------------------------------

function ApiErrorBlock({ message }: { message: SystemApiErrorMessage }) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
      <p className="text-sm font-medium text-destructive">{message.error}</p>
      <p className="mt-1 text-xs text-destructive/80">
        Retry {message.retryAttempt}/{message.maxRetries} in{" "}
        {(message.retryInMs / 1000).toFixed(1)}s
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TurnDurationBadge
// ---------------------------------------------------------------------------

function TurnDurationBadge({
  message,
}: {
  message: SystemTurnDurationMessage;
}) {
  const seconds = (message.durationMs / 1000).toFixed(1);
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
        {seconds}s
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BashProgressBlock — terminal-style monospace
// ---------------------------------------------------------------------------

function BashProgressBlock({ message }: { message: ProgressBashMessage }) {
  return (
    <div className="rounded-lg border bg-zinc-950 p-3 dark:border-zinc-800">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-zinc-300">
        {message.output}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentProgressBlock — subagent indicator
// ---------------------------------------------------------------------------

function AgentProgressBlock({ message }: { message: ProgressAgentMessage }) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <span className="font-medium">Agent started:</span>
      <span className="italic">{message.prompt}</span>
    </div>
  );
}
