import type { Subprocess } from "bun";
import type { LifecycleEvent } from "../transport";

export type SpawnFn = (
  cmd: string[],
  opts: { stdout: "ignore"; stderr: "pipe" },
) => Subprocess;

export interface ControllerOptions {
  onLifecycleEvent: (event: LifecycleEvent) => void;
  /** Override for testing. Defaults to Bun.spawn. */
  spawn?: SpawnFn;
}

export interface ManagedProcess {
  sessionId: string;
  process: Subprocess;
  startedAt: string;
}
