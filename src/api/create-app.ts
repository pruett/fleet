import { join, resolve } from "node:path";
import { Hono } from "hono";
import type { AppDependencies } from "./types";
import {
  resolveSessionFile,
  resolveGroupedProjectDirs,
} from "./resolve";
import { slugify } from "@fleet/shared";
import type { ProjectConfig } from "../config";

const HASHED_ASSET_RE = /[.-][a-zA-Z0-9]{8,}\.\w+$/;

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  // Request logging middleware
  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    const duration = Math.round(performance.now() - start);
    const status = c.res.status;
    const line = `${c.req.method} ${c.req.path} ${status} ${duration}ms`;
    if (status >= 500) {
      console.error(line);
    } else if (status >= 400) {
      console.warn(line);
    } else {
      console.info(line);
    }
  });

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  // 404 catch-all for unmatched routes
  app.notFound((c) => {
    return c.json({ error: "Not found" }, 404);
  });

  app.get("/api/projects", async (c) => {
    const [rawProjects, config] = await Promise.all([
      deps.scanner.scanProjects(deps.basePaths),
      deps.config.readConfig(),
    ]);
    const projects = deps.scanner.groupProjects(rawProjects, config.projects);
    return c.json({ projects });
  });

  app.get("/api/directories", async (c) => {
    const directories = await deps.scanner.scanProjects(deps.basePaths);
    return c.json({ directories });
  });

  app.get("/api/config", async (c) => {
    const config = await deps.config.readConfig();
    return c.json(config);
  });

  app.put("/api/config", async (c) => {
    const body = await c.req.json();
    if (!body || !Array.isArray(body.projects)) {
      return c.json(
        { error: "projects must be an array of ProjectConfig objects" },
        400,
      );
    }
    const valid = body.projects.every(
      (p: unknown) =>
        p &&
        typeof p === "object" &&
        typeof (p as ProjectConfig).title === "string" &&
        Array.isArray((p as ProjectConfig).projectIds) &&
        (p as ProjectConfig).projectIds.every(
          (d: unknown) => typeof d === "string",
        ),
    );
    if (!valid) {
      return c.json(
        {
          error:
            "Each project must have a string title and projectIds string array",
        },
        400,
      );
    }
    const config = { projects: body.projects as ProjectConfig[] };
    await deps.config.writeConfig(config);
    return c.json(config);
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

  app.post("/api/sessions/:sessionId/resume", async (c) => {
    const sessionId = c.req.param("sessionId");
    const result = await deps.controller.resumeSession(sessionId);
    if (!result.ok) {
      return c.json({ error: result.error ?? "Failed to resume session" }, 500);
    }
    return c.json({ sessionId: result.sessionId });
  });

  app.post("/api/sessions/:sessionId/message", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json();
    if (!body.message) {
      return c.json({ error: "message is required" }, 400);
    }
    const result = await deps.controller.sendMessage(sessionId, body.message);
    if (!result.ok) {
      return c.json({ error: result.error ?? "Failed to send message" }, 500);
    }
    return c.json({ sessionId: result.sessionId });
  });

  app.get("/api/projects/:slug/sessions", async (c) => {
    const slug = c.req.param("slug");
    const fleetConfig = await deps.config.readConfig();
    const config = fleetConfig.projects.find((p) => slugify(p.title) === slug);
    if (!config) {
      return c.json({ error: "Project not found" }, 404);
    }
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const dirs = await resolveGroupedProjectDirs(
      deps.basePaths,
      config.projectIds,
    );
    if (dirs.length === 0) {
      return c.json({ sessions: [] });
    }
    const allSessions = await Promise.all(
      dirs.map((dir) => deps.scanner.scanSessions(dir)),
    );
    const merged = allSessions.flat();
    merged.sort((a, b) => {
      if (a.lastActiveAt === null && b.lastActiveAt === null) return 0;
      if (a.lastActiveAt === null) return 1;
      if (b.lastActiveAt === null) return -1;
      return b.lastActiveAt.localeCompare(a.lastActiveAt);
    });
    const sessions = limit && limit > 0 ? merged.slice(0, limit) : merged;
    return c.json({ sessions });
  });

  app.get("/api/projects/:slug/worktrees", async (c) => {
    const slug = c.req.param("slug");
    const fleetConfig = await deps.config.readConfig();
    const config = fleetConfig.projects.find((p) => slugify(p.title) === slug);
    if (!config) {
      return c.json({ error: "Project not found" }, 404);
    }
    const dirs = await resolveGroupedProjectDirs(
      deps.basePaths,
      config.projectIds,
    );
    if (dirs.length === 0) {
      return c.json({ worktrees: [] });
    }
    // Each dir is basePath/dirId — decode dirId to real filesystem path
    const allWorktrees = await Promise.all(
      dirs.map((dir) => {
        const dirId = dir.split("/").pop()!;
        const projectPath = dirId.replaceAll("-", "/");
        return deps.scanner.scanWorktrees(projectPath);
      }),
    );
    const worktrees = allWorktrees.flat().sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return c.json({ worktrees });
  });

  // Static file serving (only when staticDir is configured)
  if (deps.staticDir) {
    const staticDir = resolve(deps.staticDir);

    app.get("*", async (c) => {
      const pathname = new URL(c.req.url).pathname;

      // API routes are handled by specific handlers above
      if (pathname.startsWith("/api/")) {
        return c.json({ error: "Not found" }, 404);
      }

      const filePath = resolve(join(staticDir, pathname));

      // Prevent path traversal
      if (!filePath.startsWith(staticDir + "/") && filePath !== staticDir) {
        return c.json({ error: "Not found" }, 404);
      }

      const file = Bun.file(filePath);
      if (await file.exists()) {
        const isIndex = pathname.endsWith("/index.html");
        const isHashed = HASHED_ASSET_RE.test(pathname);
        const cacheControl = isIndex
          ? "no-cache"
          : isHashed
            ? "public, max-age=31536000, immutable"
            : "public, max-age=86400";

        return new Response(await file.arrayBuffer(), {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Cache-Control": cacheControl,
          },
        });
      }

      // SPA fallback: serve index.html for non-file paths
      const indexFile = Bun.file(join(staticDir, "index.html"));
      return new Response(await indexFile.arrayBuffer(), {
        headers: {
          "Content-Type": "text/html;charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    });
  }

  return app;
}
