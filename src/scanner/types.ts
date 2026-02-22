// ============================================================
// Scanner summary types
// ============================================================

export interface ProjectSummary {
  /** Raw directory name, e.g. "-Users-foo-code-bar" */
  id: string;
  /** Base path this project was found under */
  source: string;
  /** Decoded display path, e.g. "/Users/foo/code/bar" */
  path: string;
  /** Number of top-level .jsonl session files */
  sessionCount: number;
  /** ISO 8601 timestamp from the most recent session, or null if empty */
  lastActiveAt: string | null;
}

export interface SessionSummary {
  /** UUID from the session filename */
  sessionId: string;
  /** First non-meta user message, truncated to 200 chars */
  firstPrompt: string | null;
  /** Model used, e.g. "claude-opus-4-6" */
  model: string | null;
  /** ISO 8601 timestamp of session start */
  startedAt: string | null;
  /** ISO 8601 timestamp of last activity */
  lastActiveAt: string | null;
  /** Working directory at session start */
  cwd: string | null;
  /** Git branch at session start */
  gitBranch: string | null;
  /** Input tokens excluding cached tokens — maps to API `input_tokens` field (deduplicated by response) */
  inputTokens: number;
  /** Output tokens (deduplicated by response) */
  outputTokens: number;
  /** Cache creation input tokens — maps to API `cache_creation_input_tokens` field */
  cacheCreationInputTokens: number;
  /** Cache read input tokens — maps to API `cache_read_input_tokens` field */
  cacheReadInputTokens: number;
  /** Estimated cost in USD */
  cost: number;
}
