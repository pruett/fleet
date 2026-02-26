import { createHighlighter, type Highlighter } from "shiki";

const PRELOADED_LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "bash",
  "shell",
  "python",
  "html",
  "css",
  "yaml",
  "sql",
  "rust",
  "go",
  "diff",
  "markdown",
  "toml",
] as const;

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [...PRELOADED_LANGS],
    }).catch((err) => {
      highlighterPromise = null; // allow retry on next call
      throw err;
    });
  }
  return highlighterPromise;
}
