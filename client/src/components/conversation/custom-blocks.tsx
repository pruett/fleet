import type {
  ProgressAgentMessage,
  SystemApiErrorMessage,
} from "@/types/api";

// ---------------------------------------------------------------------------
// ApiErrorBlock — red error banner
// ---------------------------------------------------------------------------

export function ApiErrorBlock({ message }: { message: SystemApiErrorMessage }) {
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
// AgentProgressBlock — subagent indicator
// ---------------------------------------------------------------------------

export function AgentProgressBlock({ message }: { message: ProgressAgentMessage }) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <span className="font-medium">Agent started:</span>
      <span className="italic">{message.prompt}</span>
    </div>
  );
}
