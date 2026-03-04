import type {
  ProjectSummary,
  SessionSummary,
  GroupedProject,
  WorktreeSummary,
} from "../scanner";
import type { EnrichedSession } from "@fleet/shared";
import type { Transport } from "../transport";
import type { FleetConfig, ProjectConfig } from "../config";

import type { ControlResult, StartSessionOpts } from "@fleet/shared";

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
  transport: Transport;
  basePaths: string[];
  staticDir: string | null;
}
