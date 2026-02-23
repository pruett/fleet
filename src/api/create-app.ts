import { Hono } from "hono";
import type { AppDependencies } from "./types";

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.get("/api/projects", async (c) => {
    const projects = await deps.scanner.scanProjects(deps.basePaths);
    return c.json({ projects });
  });

  return app;
}
