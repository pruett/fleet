import type { ParsedMessage } from "@/types/api";
import { MessageComponent } from "./MessageComponent";

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
  /** Whether this is the first group in the list (suppresses the separator). */
  isFirst: boolean;
}

/**
 * Renders a group of messages belonging to a single turn. Shows a visual
 * separator with the turn index label between consecutive turns.
 */
export function TurnGroup({ group, isFirst }: TurnGroupProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Visual separator between turns with turn index label */}
      {!isFirst && group.turnIndex !== null && (
        <div className="flex items-center py-2">
          <div className="flex-1 border-t border-border" />
          <span className="mx-3 shrink-0 text-xs font-medium text-muted-foreground">
            Turn {group.turnIndex}
          </span>
          <div className="flex-1 border-t border-border" />
        </div>
      )}
      {group.messages.map((msg, i) => (
        <MessageComponent key={`${msg.lineIndex}-${i}`} message={msg} />
      ))}
    </div>
  );
}
