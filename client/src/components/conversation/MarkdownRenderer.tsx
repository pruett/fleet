import { memo, useMemo, useCallback, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { useShikiHighlighter } from "@/hooks/use-shiki-highlighter";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";

// Assign a default lang to languageless fenced code blocks so they are
// distinguishable from inline code (react-markdown v9+ drops the `inline` prop)
function remarkDefaultCodeLang() {
  return (tree: Root) => {
    visit(tree, "code", (node) => {
      if (!node.lang) node.lang = "text";
    });
  };
}

// Stable plugin array — avoids re-parse on every render
const remarkPlugins = [remarkGfm, remarkDefaultCodeLang];

// ---------------------------------------------------------------------------
// CodeBlockWrapper — language label + copy button
// ---------------------------------------------------------------------------

function CodeBlockWrapper({
  language,
  code,
  children,
}: {
  language: string | undefined;
  code: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // Clipboard write can fail if page is not focused or in insecure context
      },
    );
  }, [code]);

  return (
    <div className="group relative my-3 overflow-hidden rounded-md border bg-muted/30">
      {language && (
        <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-1">
          <span className="text-xs text-muted-foreground">{language}</span>
        </div>
      )}
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "absolute right-2 rounded-md border bg-background p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100",
          language ? "top-9" : "top-2",
        )}
        aria-label="Copy code"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <div className="overflow-x-auto p-3 text-sm [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-0">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MarkdownRenderer
// ---------------------------------------------------------------------------

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: MarkdownRendererProps) {
  const highlighter = useShikiHighlighter();

  const components = useMemo<Components>(
    () => ({
      // Fenced code blocks: shiki highlighting
      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || "");
        const lang = match?.[1];
        const codeString = String(children).replace(/\n$/, "");

        // Inline code (no language class, no block context)
        if (!lang && !className) {
          return (
            <code
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
              {...props}
            >
              {children}
            </code>
          );
        }

        // Fenced block — try shiki, fallback to plain
        if (highlighter && lang) {
          try {
            const html = highlighter.codeToHtml(codeString, {
              lang,
              themes: { light: "github-light", dark: "github-dark" },
              defaultColor: false,
            });
            return (
              <CodeBlockWrapper language={lang} code={codeString}>
                <div dangerouslySetInnerHTML={{ __html: html }} />
              </CodeBlockWrapper>
            );
          } catch {
            // Unknown language — fall through to plain rendering
          }
        }

        return (
          <CodeBlockWrapper language={lang} code={codeString}>
            <pre className="font-mono">
              <code>{codeString}</code>
            </pre>
          </CodeBlockWrapper>
        );
      },

      // Let code component handle wrapping — prevent double <pre>
      pre({ children }) {
        return <>{children}</>;
      },

      // External links open in new tab
      a({ href, children, ...props }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          >
            {children}
          </a>
        );
      },
    }),
    [highlighter],
  );

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        // Heading sizes
        "prose-h1:text-lg prose-h1:font-semibold prose-h1:mt-4 prose-h1:mb-2",
        "prose-h2:text-base prose-h2:font-semibold prose-h2:mt-3 prose-h2:mb-1.5",
        "prose-h3:text-sm prose-h3:font-semibold prose-h3:mt-2 prose-h3:mb-1",
        // Links
        "prose-a:text-primary prose-a:underline prose-a:underline-offset-2",
        // Inline code — remove backtick decoration
        "prose-code:before:content-none prose-code:after:content-none",
        // Pre — remove default prose styling (shiki handles it)
        "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
        // Paragraphs and lists tighter spacing
        "prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5",
        // Table styling
        "prose-table:text-sm",
      )}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
