import type { ProjectSummary, SessionSummary } from "../scanner/types";
import type { EnrichedSession } from "../parser/types";
import type { Transport } from "../transport";

export interface AppDependencies {
  scanner: {
    scanProjects: (basePaths: string[]) => Promise<ProjectSummary[]>;
    scanSessions: (projectDir: string) => Promise<SessionSummary[]>;
  };
  parser: {
    parseFullSession: (content: string) => EnrichedSession;
  };
  controller: {
    startSession: (opts: StartSessionOpts) => Promise<ControlResult>;
    stopSession: (sessionId: string) => Promise<ControlResult>;
    resumeSession: (sessionId: string) => Promise<ControlResult>;
    sendMessage: (
      sessionId: string,
      message: string,
    ) => Promise<ControlResult>;
  };
  transport: Transport;
  basePaths: string[];
  staticDir: string | null;
}

export interface ControlResult {
  ok: boolean;
  sessionId: string;
  error?: string;
}

export interface StartSessionOpts {
  projectDir: string;
  prompt?: string;
  cwd?: string;
}
