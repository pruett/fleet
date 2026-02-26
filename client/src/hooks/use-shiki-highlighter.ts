import { useEffect, useState } from "react";
import { type Highlighter } from "shiki";
import { getHighlighter } from "@/lib/highlighter";

let cached: Highlighter | null = null;

export function useShikiHighlighter(): Highlighter | null {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(cached);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    getHighlighter()
      .then((hl) => {
        cached = hl;
        if (!cancelled) setHighlighter(hl);
      })
      .catch(() => {
        // Failed to load — highlighter remains null, fallback rendering kicks in
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return highlighter;
}
