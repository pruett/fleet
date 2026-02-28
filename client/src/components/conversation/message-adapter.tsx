import type { ParsedMessage } from "@/types/api";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import { ApiErrorBlock, AgentProgressBlock } from "./custom-blocks";

// ---------------------------------------------------------------------------
// Visibility filter
// ---------------------------------------------------------------------------

const HIDDEN_KINDS = new Set<string>([
  "file-history-snapshot",
  "queue-operation",
  "system-local-command",
  "progress-hook",
  "progress-bash",
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
  if (message.kind === "malformed") return false;
  return true;
}

// ---------------------------------------------------------------------------
// MessageAdapter — dispatcher
// ---------------------------------------------------------------------------

interface MessageAdapterProps {
  message: ParsedMessage;
}

export function MessageAdapter({ message }: MessageAdapterProps) {
  switch (message.kind) {
    case "user-prompt":
      if (message.isMeta) return null;
      return (
        <Message from="user" data-type="user-prompt">
          <MessageContent>
            <MessageResponse>{message.text}</MessageResponse>
          </MessageContent>
        </Message>
      );

    case "assistant-block":
      switch (message.contentBlock.type) {
        case "text":
          return (
            <MessageResponse
              data-type="assistant-text"
              className="min-w-0 overflow-hidden text-sm text-foreground"
            >
              {message.contentBlock.text}
            </MessageResponse>
          );
        case "thinking":
          return (
            <Reasoning data-type="assistant-thinking" defaultOpen={false}>
              <ReasoningTrigger />
              <ReasoningContent>{message.contentBlock.thinking}</ReasoningContent>
            </Reasoning>
          );
        case "tool_use":
          return null;
      }
      return null;

    case "system-api-error":
      return <ApiErrorBlock data-type="system-api-error" message={message} />;

    case "progress-agent":
      return <AgentProgressBlock data-type="progress-agent" message={message} />;

    // Non-rendered kinds (filtered by isVisibleMessage, but kept for exhaustiveness)
    case "progress-bash":
    case "user-tool-result":
    case "system-turn-duration":
    case "file-history-snapshot":
    case "queue-operation":
    case "system-local-command":
    case "progress-hook":
    case "malformed":
      return null;

    default: {
      const _exhaustive: never = message;
      void _exhaustive;
      return null;
    }
  }
}
