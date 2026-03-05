import { useCallback, useMemo } from "react";
import type { AnalyticsFields } from "@/lib/incremental-analytics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  TurnGroup,
  groupMessagesByTurn,
} from "@/components/conversation/turn-group";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextCacheUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";
import { useSessionData, type SessionStatus } from "@/hooks/use-session-data";
import type { ConnectionInfo } from "@/lib/ws";
import { GitBranch, GlobeIcon, PaperclipIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Shared presentational components
// ---------------------------------------------------------------------------

const STATUS_DOT_COLOR: Record<SessionStatus, string> = {
  ready: "bg-green-500",
  working: "bg-orange-500 animate-pulse",
  error: "bg-red-500",
};

function SessionStatusIndicator({ status }: { status: SessionStatus }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="text-muted-foreground/50">Status:</span>
      <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_COLOR[status]}`} />
    </span>
  );
}

function ConnectionStatusIndicator({ info }: { info: ConnectionInfo | null }) {
  if (!info || info.status === "connected" || info.status === "disconnected") {
    return null;
  }

  if (info.status === "connecting") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-yellow-500">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
        Connecting…
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-red-500">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
      Reconnecting… ({info.attempt})
    </span>
  );
}

// ---------------------------------------------------------------------------
// Context usage indicator (AI Elements compound component)
// ---------------------------------------------------------------------------

function SessionContextUsage({
  analytics,
  contextWindowSize,
  modelId,
}: {
  analytics: AnalyticsFields;
  contextWindowSize: number;
  modelId: string | null;
}) {
  const { contextSnapshots, totals } = analytics;
  if (contextSnapshots.length === 0) return null;

  const last = contextSnapshots[contextSnapshots.length - 1];
  const usedTokens = last.inputTokens + last.outputTokens;

  return (
    <Context
      usedTokens={usedTokens}
      maxTokens={contextWindowSize}
      usage={{
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        totalTokens: totals.totalTokens,
        cachedInputTokens: totals.cacheReadInputTokens,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: totals.cacheReadInputTokens || undefined,
          cacheWriteTokens: totals.cacheCreationInputTokens || undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      }}
      modelId={modelId ?? undefined}
    >
      <ContextTrigger size="sm" />
      <ContextContent align="end" side="top" sideOffset={8}>
        <ContextContentHeader />
        <ContextContentBody className="space-y-1">
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextCacheUsage />
        </ContextContentBody>
        <ContextContentFooter />
      </ContextContent>
    </Context>
  );
}

// ---------------------------------------------------------------------------
// SessionPanel — embedded session viewer for SidebarInset
// ---------------------------------------------------------------------------

interface SessionPanelProps {
  sessionId: string;
  projectId?: string | null;
  onGoSession?: (sessionId: string) => void;
}

export function SessionPanel({
  sessionId,
  projectId,
  onGoSession,
}: SessionPanelProps) {
  const { open: sidebarOpen, isMobile } = useSidebar();
  const {
    session,
    loading,
    error,
    errorStatus,
    connectionInfo,
    visibleMessages,
    sessionMeta,
    sessionStatus,
    liveAnalytics,
    handleSendMessage,
    retry,
  } = useSessionData({ sessionId, projectId, onGoSession });

  const handlePromptSubmit = useCallback(
    async (message: { text: string }) => {
      if (!message.text.trim()) return;
      await handleSendMessage(message.text);
    },
    [handleSendMessage],
  );

  const turnGroups = useMemo(
    () => groupMessagesByTurn(visibleMessages),
    [visibleMessages],
  );

  // -- Loading state --------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading session…</p>
      </div>
    );
  }

  // -- Error states ---------------------------------------------------------

  if (error) {
    if (errorStatus === 404) {
      return (
        <div className="flex h-full items-center justify-center">
          <Alert className="max-w-md">
            <AlertTitle>Session not found</AlertTitle>
            <AlertDescription>
              <p>The session could not be found. It may have been deleted or the ID is invalid.</p>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Failed to load session</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>{error}</p>
            <Button variant="outline" size="sm" className="w-fit" onClick={retry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Session not found</p>
      </div>
    );
  }

  // -- Main content ---------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {/* Header bar with status */}
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between border-b bg-background px-4 shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-2 text-sm">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          {sessionMeta?.model && (
            <span className="text-muted-foreground">
              <span className="text-muted-foreground/50">Model:</span> {sessionMeta.model}
            </span>
          )}
          <span className="font-mono text-muted-foreground">
            <span className="font-sans text-muted-foreground/50">Session ID:</span> {sessionId}
          </span>
          {sessionMeta?.gitBranch && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <span className="text-muted-foreground/50">Branch:</span>
              <GitBranch className="size-3.5" />
              {sessionMeta.gitBranch}
            </span>
          )}
        </div>
        <ConnectionStatusIndicator info={connectionInfo} />
      </div>

      {/* Conversation */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Conversation className="h-full">
          {visibleMessages.length === 0 ? (
            <ConversationContent className="h-full">
              <ConversationEmptyState title="No messages yet" description="" />
            </ConversationContent>
          ) : (
            <ConversationContent className="gap-4 p-6 pb-[calc(var(--prompt-input-height)*2)]">
              {turnGroups.map((group) => (
                <TurnGroup
                  key={group.turnIndex ?? "pre"}
                  group={group}
                />
              ))}
            </ConversationContent>
          )}
          <ConversationScrollButton className="bottom-[var(--prompt-input-height)]" />
        </Conversation>
      </div>

      {/* Fixed prompt input — pinned to bottom of screen, always visible */}
      <div
        className="pointer-events-none fixed right-0 bottom-0 h-[var(--prompt-input-height)] bg-gradient-to-t from-background from-80% to-transparent px-6 pb-4 transition-[left] duration-200 ease-linear"
        style={{ left: sidebarOpen && !isMobile ? "var(--sidebar-width)" : 0 }}
      >
        <PromptInput
          onSubmit={handlePromptSubmit}
          className="pointer-events-auto [&_[data-slot=input-group]]:rounded-[0.5rem] [&_[data-slot=input-group]]:bg-background"
        >
          <PromptInputBody>
            <PromptInputTextarea
              placeholder="Send a message…"
              disabled={sessionStatus === "working"}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputButton tooltip="Attach files">
                <PaperclipIcon className="size-4" />
              </PromptInputButton>
              <PromptInputButton tooltip="Search the web">
                <GlobeIcon className="size-4" />
              </PromptInputButton>
            </PromptInputTools>
            <div className="flex items-center gap-2">
              <SessionStatusIndicator status={sessionStatus} />
              {liveAnalytics && session?.contextWindowSize && (
                <SessionContextUsage
                  analytics={liveAnalytics}
                  contextWindowSize={session.contextWindowSize}
                  modelId={sessionMeta?.model ?? null}
                />
              )}
              <PromptInputSubmit disabled={sessionStatus === "working"} />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
