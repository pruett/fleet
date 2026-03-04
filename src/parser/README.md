# Parser Module

Parses Claude Code JSONL transcript files into typed, enriched structures.

## Public Interface

### Functions

- **`parseLine(line: string, lineIndex: number): ParsedMessage | null`** — Parses a single JSONL line into a typed message. Returns `null` for blank lines, `MalformedRecord` for invalid input. Never throws.
- **`parseFullSession(content: string): EnrichedSession`** — Parses a complete session transcript into an enriched session with turns, tool stats, cost, and context snapshots.
- **`computeCost(inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, model): number`** — Estimates API cost in USD based on token usage and model. Returns `0` for unknown models.

### Types

- **`ParsedMessage`** — Union of all possible parsed message variants.
- **`EnrichedSession`** — Session data enriched with cross-message analysis.
