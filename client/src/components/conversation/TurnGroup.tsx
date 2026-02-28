import type { ParsedMessage } from "@/types/api";
import { MessageAdapter } from "./message-adapter";

// ---------------------------------------------------------------------------
// Turn grouping logic
// ---------------------------------------------------------------------------

export interface TurnGroupData {
  /** 1-based turn index, or null for messages before the first user prompt. */
  turnIndex: number | null;
  messages: ParsedMessage[];
}

/**
 * Group visible messages into turns. Each turn starts at a `user-prompt`
 * message and spans until the next `user-prompt`. Any messages before the
 * first prompt are collected into a pre-turn group with `turnIndex: null`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function groupMessagesByTurn(
  messages: ParsedMessage[],
): TurnGroupData[] {
  const groups: TurnGroupData[] = [];
  let current: TurnGroupData | null = null;
  let turnCounter = 0;

  for (const msg of messages) {
    if (msg.kind === "user-prompt") {
      turnCounter++;
      current = { turnIndex: turnCounter, messages: [msg] };
      groups.push(current);
    } else {
      if (!current) {
        current = { turnIndex: null, messages: [] };
        groups.push(current);
      }
      current.messages.push(msg);
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// TurnGroup component
// ---------------------------------------------------------------------------

interface TurnGroupProps {
  group: TurnGroupData;
}

/**
 * Renders a group of messages belonging to a single turn.
 */
export function TurnGroup({ group }: TurnGroupProps) {
  return (
    <div className="flex flex-col gap-4">
      {group.messages.map((msg, i) => (
        <MessageAdapter key={`${msg.lineIndex}-${i}`} message={msg} />
      ))}
    </div>
  );
}
