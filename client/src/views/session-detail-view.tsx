import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Header } from "@/components/header";
import { SessionSearch } from "@/components/session-search";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { useProjects } from "@/hooks/use-projects";
import { useGlobalSSE } from "@/hooks/use-global-sse";
import { useSession } from "@/hooks/use-session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  TurnGroup,
  groupMessagesByTurn,
} from "@/components/conversation/turn-group";
import { BotIcon, GitBranch } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SessionDetailView() {
  const { projectId, sessionId } = useParams<{
    projectId: string;
    sessionId: string;
  }>();
  const {
    projects,
    projectSlugs,
    allDirectories,
    loadingDirectories,
    addProject,
    refreshDirectories,
  } = useProjects();
  const [searchOpen, setSearchOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
    refreshDirectories();
  }, [refreshDirectories]);

  useGlobalSSE();

  const {
    session,
    loading,
    error,
    visibleMessages,
    sessionMeta,
    retry,
  } = useSession({ sessionId: sessionId ?? "", projectId });

  const turnGroups = useMemo(
    () => groupMessagesByTurn(visibleMessages),
    [visibleMessages],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // -- Loading state
  if (loading) {
    return (
      <div className="min-h-screen">
        <Header projects={projects} selectedSlug={projectId} onAddProject={handleOpenDialog} />
        <div className="flex h-[calc(100vh-65px)] items-center justify-center">
          <p className="text-muted-foreground">Loading session…</p>
        </div>
      </div>
    );
  }

  // -- Error state
  if (error) {
    return (
      <div className="min-h-screen">
        <Header projects={projects} selectedSlug={projectId} onAddProject={handleOpenDialog} />
        <div className="flex h-[calc(100vh-65px)] items-center justify-center">
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
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen">
        <Header projects={projects} selectedSlug={projectId} onAddProject={handleOpenDialog} />
        <div className="flex h-[calc(100vh-65px)] items-center justify-center">
          <p className="text-muted-foreground">Session not found</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-screen flex-col overflow-hidden">
        <Header projects={projects} selectedSlug={projectId} onAddProject={handleOpenDialog} />

        <Tabs defaultValue="conversation" className="flex flex-1 flex-col min-h-0 gap-0">
          <div className="border-b">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {sessionMeta?.model && (
                  <span className="flex items-center gap-1.5">
                    <BotIcon className="size-3.5 text-muted-foreground/60" />
                    {sessionMeta.model}
                  </span>
                )}
                {sessionMeta?.gitBranch && (
                  <span className="flex items-center gap-1.5">
                    <GitBranch className="size-3.5 text-muted-foreground/60" />
                    {sessionMeta.gitBranch}
                  </span>
                )}
              </div>
              <TabsList>
                <TabsTrigger value="conversation">Conversation</TabsTrigger>
                <TabsTrigger value="diff">Diff</TabsTrigger>
              </TabsList>
            </div>
          </div>

          {/* Conversation */}
          <TabsContent value="conversation" className="flex-1 min-h-0">
            <Conversation className="h-full">
              {visibleMessages.length === 0 ? (
                <ConversationContent className="h-full">
                  <ConversationEmptyState title="No messages yet" description="" />
                </ConversationContent>
              ) : (
                <ConversationContent className="mx-auto w-full max-w-3xl gap-4 px-6 py-6">
                  {turnGroups.map((group) => (
                    <TurnGroup key={group.turnIndex ?? "pre"} group={group} />
                  ))}
                </ConversationContent>
              )}
              <ConversationScrollButton />
            </Conversation>
          </TabsContent>

          {/* Diff (coming soon) */}
          <TabsContent value="diff" className="flex-1 min-h-0">
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground text-sm">Diff view coming soon</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <AddProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        directories={allDirectories}
        loading={loadingDirectories}
        existingSlugs={projectSlugs}
        onAddProject={addProject}
      />

      <SessionSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        projects={projects}
      />
    </>
  );
}
