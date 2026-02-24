import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ConversationContextValue {
  isAtBottom: boolean;
  scrollToBottom: () => void;
}

const ConversationContext = createContext<ConversationContextValue>({
  isAtBottom: true,
  scrollToBottom: () => {},
});

// ---------------------------------------------------------------------------
// Conversation — scrollable container with auto-scroll behaviour
// ---------------------------------------------------------------------------

interface ConversationProps {
  children: ReactNode;
  /** Number of visible messages — used to trigger auto-scroll on change. */
  messageCount: number;
  className?: string;
}

/**
 * Scrollable conversation container that auto-scrolls to the bottom when new
 * messages arrive, as long as the user hasn't manually scrolled up.  Provides
 * context consumed by `ConversationScrollButton`.
 */
export function Conversation({
  children,
  messageCount,
  className,
}: ConversationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // Ref mirrors state for use inside callbacks/effects without stale closure.
  const isAtBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  // Auto-scroll when new messages arrive (messageCount changes).
  useEffect(() => {
    if (isAtBottomRef.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messageCount]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  return (
    <ConversationContext.Provider value={{ isAtBottom, scrollToBottom }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={cn("relative overflow-y-auto", className)}
      >
        {children}
        <div ref={endRef} aria-hidden="true" />
      </div>
    </ConversationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// ConversationScrollButton — floating "scroll to bottom" indicator
// ---------------------------------------------------------------------------

/**
 * Renders a sticky button at the bottom of the `Conversation` container when
 * the user has scrolled away from the bottom.  Clicking it smooth-scrolls to
 * the latest message and re-engages auto-scroll.
 */
export function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useContext(ConversationContext);

  if (isAtBottom) return null;

  return (
    <div className="sticky bottom-4 flex justify-center">
      <Button
        variant="secondary"
        size="sm"
        onClick={scrollToBottom}
        className="shadow-md"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mr-1"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        Scroll to bottom
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConversationEmptyState — placeholder when there are no messages
// ---------------------------------------------------------------------------

interface ConversationEmptyStateProps {
  children: ReactNode;
}

export function ConversationEmptyState({
  children,
}: ConversationEmptyStateProps) {
  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}
