import type {
  ProjectSummary,
  SessionSummary,
  GroupedProject,
  WorktreeSummary,
  EnrichedSession,
  FleetConfig,
  ProjectConfig,
  ControlResult,
  StartSessionOpts,
} from "@fleet/shared";
import type { Sse } from "../sse";

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
  config: {
    readConfig: () => Promise<FleetConfig>;
    writeConfig: (config: FleetConfig) => Promise<void>;
  };
  sse: Sse;
  basePaths: string[];
  staticDir: string | null;
}
