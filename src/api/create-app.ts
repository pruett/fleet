import { Hono } from "hono";
import type { AppDependencies } from "./types";
import { resolveProjectDir } from "./resolve";

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.get("/api/projects", async (c) => {
    const projects = await deps.scanner.scanProjects(deps.basePaths);
    return c.json({ projects });
  });

  app.get("/api/projects/:projectId/sessions", async (c) => {
    const projectId = c.req.param("projectId");
    const projectDir = await resolveProjectDir(deps.basePaths, projectId);
    if (!projectDir) {
      return c.json({ error: "Project not found" }, 404);
    }
    const sessions = await deps.scanner.scanSessions(projectDir);
    return c.json({ sessions });
  });

  return app;
}
