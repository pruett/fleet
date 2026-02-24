import { useCallback, useState, useSyncExternalStore } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectListView } from "@/views/ProjectListView";
import { SessionListView } from "@/views/SessionListView";
import { SessionView } from "@/views/SessionView";
import { DashboardView } from "@/views/DashboardView";

// ---------------------------------------------------------------------------
// Minimal hash-based router
// Routes: #/ (projects), #/project/:id (sessions), #/session/:id (session)
// ---------------------------------------------------------------------------

type Route =
  | { view: "dashboard" }
  | { view: "projects" }
  | { view: "sessions"; projectId: string }
  | { view: "session"; sessionId: string };

function parseRoute(): Route {
  const hash = window.location.hash;
  const path = hash.replace(/^#\/?/, "/");

  // Hash routes take priority so links from /new still work
  const projectMatch = path.match(/^\/project\/(.+)$/);
  if (projectMatch) {
    return { view: "sessions", projectId: decodeURIComponent(projectMatch[1]) };
  }

  const sessionMatch = path.match(/^\/session\/(.+)$/);
  if (sessionMatch) {
    return { view: "session", sessionId: decodeURIComponent(sessionMatch[1]) };
  }

  // Path-based route when no hash route matched
  if (window.location.pathname === "/new" || window.location.pathname.startsWith("/new/")) {
    return { view: "dashboard" };
  }

  return { view: "projects" };
}

function navigate(path: string) {
  window.location.hash = path;
}

function subscribeToRoute(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
}

function getRouteSnapshot() {
  // Combine pathname + hash so any change is detected
  return window.location.pathname + window.location.hash;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const _snapshot = useSyncExternalStore(subscribeToRoute, getRouteSnapshot);
  const route = parseRoute();

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
    case "dashboard":
      view = <DashboardView />;
      break;
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
    <TooltipProvider>
      {view}
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
