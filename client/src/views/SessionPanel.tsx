import { useCallback } from "react";
import { timeAgo } from "@/lib/time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import {
  TurnGroup,
  groupMessagesByTurn,
} from "@/components/conversation/TurnGroup";
import { AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  useSessionData,
  type SessionStatus,
  statusConfig,
  formatTokens,
  formatCost,
} from "@/hooks/use-session-data";
import type { ConnectionInfo } from "@/lib/ws";

// ---------------------------------------------------------------------------
// Shared presentational components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant}>
      {config.dotClass && (
        <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
      )}
      {config.label}
    </Badge>
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
  const {
    session,
    loading,
    error,
    errorStatus,
    sessionStatus,
    connectionInfo,
    analyticsOpen,
    setAnalyticsOpen,
    visibleMessages,
    displayTotals,
    displayTurns,
    analyticsSession,
    sessionMeta,
    handleSendMessage,
    retry,
    sendingMessage,
  } = useSessionData({ sessionId, projectId, onGoSession });

  const handlePromptSubmit = useCallback(
    async (message: { text: string }) => {
      if (!message.text.trim()) return;
      await handleSendMessage(message.text);
    },
    [handleSendMessage],
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
    <Sheet open={analyticsOpen} onOpenChange={setAnalyticsOpen}>
      <div className="flex h-full flex-col">
        {/* Header bar with status + analytics toggle */}
        <div className="flex items-center justify-between border-b px-6 py-2">
          <div className="flex items-center gap-4 text-sm">
            <StatusBadge status={sessionStatus} />
            {sessionMeta?.model && (
              <span className="text-muted-foreground">{sessionMeta.model}</span>
            )}
            {sessionMeta?.startedAt && (
              <span className="text-muted-foreground">
                Started {timeAgo(sessionMeta.startedAt)}
              </span>
            )}
            {displayTotals && (
              <>
                <span className="text-muted-foreground">
                  {formatTokens(displayTotals.totalTokens)} tokens
                </span>
                <span className="text-muted-foreground">
                  {formatCost(displayTotals.estimatedCostUsd)}
                </span>
              </>
            )}
            {displayTurns && (
              <span className="text-muted-foreground">
                {displayTurns.length} {displayTurns.length === 1 ? "turn" : "turns"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ConnectionStatusIndicator info={connectionInfo} />
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={analyticsOpen ? "Hide analytics" : "Show analytics"}
                title={analyticsOpen ? "Hide analytics" : "Show analytics"}
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
                >
                  {analyticsOpen ? (
                    <>
                      <rect width="18" height="18" x="3" y="3" rx="2" />
                      <path d="M15 3v18" />
                      <path d="m10 15-3-3 3-3" />
                    </>
                  ) : (
                    <>
                      <rect width="18" height="18" x="3" y="3" rx="2" />
                      <path d="M15 3v18" />
                      <path d="m10 9 3 3-3 3" />
                    </>
                  )}
                </svg>
              </Button>
            </SheetTrigger>
          </div>
        </div>

        {/* Content area — full width (analytics moved to Sheet) */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Conversation className="flex-1 min-h-0">
            {visibleMessages.length === 0 ? (
              <ConversationContent className="h-full">
                <ConversationEmptyState title="No messages yet" description="" />
              </ConversationContent>
            ) : (
              <ConversationContent className="mx-auto max-w-3xl gap-4 p-6">
                {groupMessagesByTurn(visibleMessages).map((group) => (
                  <TurnGroup
                    key={group.turnIndex ?? "pre"}
                    group={group}
                  />
                ))}
              </ConversationContent>
            )}
            <ConversationScrollButton />
          </Conversation>

          {/* Message input */}
          <div className="border-t px-6 py-3">
            <div className="mx-auto max-w-3xl">
              <PromptInput onSubmit={handlePromptSubmit}>
                <PromptInputTextarea
                  placeholder="Send a message…"
                  disabled={sendingMessage}
                />
                <PromptInputSubmit
                  disabled={sendingMessage}
                />
              </PromptInput>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics side sheet */}
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[360px] sm:max-w-[360px] border-l-0 p-0"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">Session Analytics</SheetTitle>
        {analyticsSession && <AnalyticsPanel session={analyticsSession} />}
      </SheetContent>
    </Sheet>
  );
}
