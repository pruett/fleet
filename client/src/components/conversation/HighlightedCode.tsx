import { memo } from "react";
import { useShikiHighlighter } from "@/hooks/use-shiki-highlighter";

interface HighlightedCodeProps {
  code: string;
  lang: string;
  className?: string;
}

/**
 * Renders a code string with shiki syntax highlighting.
 * Falls back to plain monospace while the highlighter loads or for unknown languages.
 */
export const HighlightedCode = memo(function HighlightedCode({
  code,
  lang,
  className,
}: HighlightedCodeProps) {
  const highlighter = useShikiHighlighter();

  if (highlighter) {
    try {
      const html = highlighter.codeToHtml(code, {
        lang,
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      });
      return (
        <div
          className={className}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } catch {
      // Unknown language — fall through to plain rendering
    }
  }

  return (
    <pre className={className}>
      <code>{code}</code>
    </pre>
  );
});
