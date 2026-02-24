import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Context — coordinates "Expand all" / "Collapse all" across collapsible blocks
// ---------------------------------------------------------------------------

interface CollapsibleGroupContextValue {
  /** Monotonically increasing counter — bumped on each global toggle. */
  generation: number;
  /** The target state from the last global toggle, or null if none yet. */
  globalOpen: boolean | null;
  expandAll: () => void;
  collapseAll: () => void;
}

const CollapsibleGroupContext = createContext<CollapsibleGroupContextValue>({
  generation: 0,
  globalOpen: null,
  expandAll: () => {},
  collapseAll: () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function CollapsibleGroupProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [generation, setGeneration] = useState(0);
  const [globalOpen, setGlobalOpen] = useState<boolean | null>(null);

  const expandAll = useCallback(() => {
    setGlobalOpen(true);
    setGeneration((g) => g + 1);
  }, []);

  const collapseAll = useCallback(() => {
    setGlobalOpen(false);
    setGeneration((g) => g + 1);
  }, []);

  return (
    <CollapsibleGroupContext.Provider
      value={{ generation, globalOpen, expandAll, collapseAll }}
    >
      {children}
    </CollapsibleGroupContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook — individual collapsible state that responds to group signals
// ---------------------------------------------------------------------------

/**
 * Manages open/closed state for a single collapsible block. The block starts
 * in `defaultOpen` and can be individually toggled. When the user triggers
 * "Expand all" or "Collapse all", the block syncs to the group signal.
 *
 * Uses the "adjust state during render" pattern (no useEffect) to avoid
 * cascading renders. See:
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useCollapsibleState(defaultOpen: boolean) {
  const { generation, globalOpen } = useContext(CollapsibleGroupContext);
  const [state, setState] = useState({ open: defaultOpen, syncedGen: 0 });

  // Adjust state during render when group signal changes (no effect needed).
  let { open } = state;
  if (generation !== state.syncedGen && globalOpen !== null) {
    open = globalOpen;
    setState({ open: globalOpen, syncedGen: generation });
  }

  const setOpen = useCallback((next: boolean) => {
    setState((prev) => ({ ...prev, open: next }));
  }, []);

  return [open, setOpen] as const;
}

// ---------------------------------------------------------------------------
// ExpandCollapseToggle — button to expand/collapse all blocks
// ---------------------------------------------------------------------------

/**
 * Renders "Expand all" / "Collapse all" toggle button at the top of the
 * conversation panel. Toggles between the two states.
 */
export function ExpandCollapseToggle() {
  const { globalOpen, expandAll, collapseAll } =
    useContext(CollapsibleGroupContext);

  // If the last action was "expand all", show "Collapse all" (and vice versa).
  // Default to "Expand all" when no global action has been taken yet.
  const showExpand = globalOpen !== true;

  return (
    <button
      type="button"
      onClick={showExpand ? expandAll : collapseAll}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {showExpand ? "Expand all" : "Collapse all"}
    </button>
  );
}
