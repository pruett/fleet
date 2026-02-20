import { parseLine } from "./parse-line";
import { enrichSession } from "./enrich-session";
import type { EnrichedSession } from "./types";

/**
 * Parse a full JSONL session transcript into an enriched session.
 *
 * Splits on newlines, parses each line via parseLine, filters nulls,
 * and passes the result to enrichSession for cross-message analysis.
 */
export function parseFullSession(content: string): EnrichedSession {
  const messages = content
    .split("\n")
    .map((line, index) => parseLine(line, index))
    .filter((msg): msg is NonNullable<typeof msg> => msg !== null);

  return enrichSession(messages);
}
