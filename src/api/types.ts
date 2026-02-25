import type {
  ProjectSummary,
  SessionSummary,
  GroupedProject,
  WorktreeSummary,
} from "../scanner/types";
import type { EnrichedSession } from "../parser/types";
import type { Transport } from "../transport";
import type { FleetPreferences, ProjectConfig } from "../preferences";

export interface AppDependencies {
  scanner: {
    scanProjects: (basePaths: string[]) => Promise<ProjectSummary[]>;
    scanSessions: (projectDir: string) => Promise<SessionSummary[]>;
    groupProjects: (
      rawProjects: ProjectSummary[],
      configs: ProjectConfig[],
    ) => GroupedProject[];
    scanWorktrees: (projectPath: string) => Promise<WorktreeSummary[]>;
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
  preferences: {
    readPreferences: () => Promise<FleetPreferences>;
    writePreferences: (prefs: FleetPreferences) => Promise<void>;
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
