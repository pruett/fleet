import type { HTMLAttributes } from "react";
import type {
  ProgressAgentMessage,
  SystemApiErrorMessage,
} from "@/types/api";

// ---------------------------------------------------------------------------
// ApiErrorBlock — red error banner
// ---------------------------------------------------------------------------

type ApiErrorBlockProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  message: SystemApiErrorMessage;
};

export function ApiErrorBlock({ message, ...props }: ApiErrorBlockProps) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3" {...props}>
      <p className="text-sm font-medium text-destructive">{message.error}</p>
      <p className="mt-1 text-xs text-destructive/80">
        Retry {message.retryAttempt}/{message.maxRetries} in{" "}
        {(message.retryInMs / 1000).toFixed(1)}s
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentProgressBlock — subagent indicator
// ---------------------------------------------------------------------------

type AgentProgressBlockProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  message: ProgressAgentMessage;
};

export function AgentProgressBlock({ message, ...props }: AgentProgressBlockProps) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground" {...props}>
      <span className="font-medium">Agent started:</span>
      <span className="italic">{message.prompt}</span>
    </div>
  );
}
