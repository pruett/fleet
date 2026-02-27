import type { ControlResult, StartSessionOpts } from "../api/types";
import type { ControllerOptions, ManagedProcess } from "./types";

export interface Controller {
  sendMessage: (sessionId: string, message: string) => Promise<ControlResult>;
  stopSession: (sessionId: string) => Promise<ControlResult>;
  resumeSession: (sessionId: string) => Promise<ControlResult>;
  startSession: (opts: StartSessionOpts) => Promise<ControlResult>;
  shutdown: () => void;
}

export function createController(options: ControllerOptions): Controller {
  const spawn = options.spawn ?? Bun.spawn;
  const registry = new Map<string, ManagedProcess>();
  let shuttingDown = false;

  async function sendMessage(
    sessionId: string,
    message: string,
  ): Promise<ControlResult> {
    if (registry.has(sessionId)) {
      return { ok: false, sessionId, error: "Session is busy" };
    }

    const proc = spawn(
      ["claude", "-p", "--resume", sessionId, "--", message],
      {
        stdout: "ignore",
        stderr: "pipe",
      },
    );

    const managed: ManagedProcess = {
      sessionId,
      process: proc,
      startedAt: new Date().toISOString(),
    };

    registry.set(sessionId, managed);

    options.onLifecycleEvent({
      type: "session:activity",
      sessionId,
      updatedAt: managed.startedAt,
    });

    proc.exited
      .then(async (exitCode) => {
        registry.delete(sessionId);

        if (shuttingDown) return;

        if (exitCode !== 0) {
          let errorMsg = `Process exited with code ${exitCode}`;
          try {
            if (proc.stderr && typeof proc.stderr !== "number") {
              const stderr = await new Response(proc.stderr).text();
              if (stderr.trim()) {
                errorMsg = stderr.trim();
              }
            }
          } catch {
            // stderr may already be consumed or closed
          }

          options.onLifecycleEvent({
            type: "session:error",
            sessionId,
            error: errorMsg,
            occurredAt: new Date().toISOString(),
          });
        }

        options.onLifecycleEvent({
          type: "session:stopped",
          sessionId,
          reason: exitCode === 0 ? "completed" : "errored",
          stoppedAt: new Date().toISOString(),
        });
      })
      .catch((err) => {
        console.error("exit handler error", err);
      });

    return { ok: true, sessionId };
  }

  async function stopSession(sessionId: string): Promise<ControlResult> {
    const managed = registry.get(sessionId);
    if (!managed) {
      return { ok: false, sessionId, error: "No running process" };
    }

    managed.process.kill("SIGINT");
    await managed.process.exited;
    return { ok: true, sessionId };
  }

  async function resumeSession(sessionId: string): Promise<ControlResult> {
    return {
      ok: false,
      sessionId,
      error: "Use sendMessage to continue a conversation",
    };
  }

  async function startSession(
    _opts: StartSessionOpts,
  ): Promise<ControlResult> {
    return { ok: false, sessionId: "", error: "Not implemented" };
  }

  function shutdown(): void {
    shuttingDown = true;
    for (const managed of registry.values()) {
      managed.process.kill("SIGTERM");
    }
    registry.clear();
  }

  return {
    sendMessage,
    stopSession,
    resumeSession,
    startSession,
    shutdown,
  };
}
