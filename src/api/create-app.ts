import { Hono } from "hono";
import type { AppDependencies } from "./types";
import { resolveProjectDir, resolveSessionFile } from "./resolve";

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.get("/api/projects", async (c) => {
    const projects = await deps.scanner.scanProjects(deps.basePaths);
    return c.json({ projects });
  });

  app.post("/api/sessions", async (c) => {
    const body = await c.req.json();
    if (!body.projectDir) {
      return c.json({ error: "projectDir is required" }, 400);
    }
    const result = await deps.controller.startSession({
      projectDir: body.projectDir,
      prompt: body.prompt,
      cwd: body.cwd,
    });
    if (!result.ok) {
      return c.json({ error: result.error ?? "Failed to start session" }, 500);
    }
    return c.json({ sessionId: result.sessionId }, 201);
  });

  app.get("/api/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const sessionFile = await resolveSessionFile(deps.basePaths, sessionId);
    if (!sessionFile) {
      return c.json({ error: "Session not found" }, 404);
    }
    const content = await Bun.file(sessionFile).text();
    const session = deps.parser.parseFullSession(content);
    return c.json({ session });
  });

  app.post("/api/sessions/:sessionId/stop", async (c) => {
    const sessionId = c.req.param("sessionId");
    const result = await deps.controller.stopSession(sessionId);
    if (!result.ok) {
      return c.json({ error: result.error ?? "Failed to stop session" }, 500);
    }
    return c.json({ sessionId: result.sessionId });
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
