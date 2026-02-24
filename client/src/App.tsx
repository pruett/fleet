import { useCallback, useState, useSyncExternalStore } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ProjectListView } from "@/views/ProjectListView";
import { SessionListView } from "@/views/SessionListView";
import { SessionView } from "@/views/SessionView";

// ---------------------------------------------------------------------------
// Minimal hash-based router
// Routes: #/ (projects), #/project/:id (sessions), #/session/:id (session)
// ---------------------------------------------------------------------------

type Route =
  | { view: "projects" }
  | { view: "sessions"; projectId: string }
  | { view: "session"; sessionId: string };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "/");

  const projectMatch = path.match(/^\/project\/(.+)$/);
  if (projectMatch) {
    return { view: "sessions", projectId: decodeURIComponent(projectMatch[1]) };
  }

  const sessionMatch = path.match(/^\/session\/(.+)$/);
  if (sessionMatch) {
    return { view: "session", sessionId: decodeURIComponent(sessionMatch[1]) };
  }

  return { view: "projects" };
}

function navigate(path: string) {
  window.location.hash = path;
}

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getHashSnapshot() {
  return window.location.hash;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const hash = useSyncExternalStore(subscribeToHash, getHashSnapshot);
  const route = parseHash(hash);

  // Track last-visited projectId so SessionView breadcrumbs can link back
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);

  const goToProjects = useCallback(() => navigate("/"), []);
  const goToProject = useCallback(
    (projectId: string) => navigate(`/project/${encodeURIComponent(projectId)}`),
    [],
  );
  const goToSession = useCallback(
    (sessionId: string) => navigate(`/session/${encodeURIComponent(sessionId)}`),
    [],
  );

  let view: React.ReactNode;
  switch (route.view) {
    case "projects":
      view = <ProjectListView onSelectProject={goToProject} />;
      break;
    case "sessions":
      view = (
        <SessionListView
          projectId={route.projectId}
          onSelectSession={(sessionId) => {
            setLastProjectId(route.projectId);
            goToSession(sessionId);
          }}
          onBack={goToProjects}
        />
      );
      break;
    case "session":
      view = (
        <SessionView
          key={route.sessionId}
          sessionId={route.sessionId}
          projectId={lastProjectId}
          onBack={goToProjects}
          onGoProject={
            lastProjectId
              ? () => goToProject(lastProjectId)
              : undefined
          }
          onGoSession={goToSession}
        />
      );
      break;
  }

  return (
    <>
      {view}
      <Toaster />
    </>
  );
}

export default App;
