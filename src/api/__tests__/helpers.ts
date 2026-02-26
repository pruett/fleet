import type { AppDependencies, ControlResult } from "../types";
import type { ProjectSummary, SessionSummary } from "../../scanner";
import type { EnrichedSession } from "../../parser";
import type { Transport } from "../../transport";

/**
 * Creates a mock AppDependencies with sensible defaults.
 * All functions are stubs that return empty/success results.
 * Override any property via the `overrides` parameter.
 */
export function createMockDeps(
  overrides: Partial<AppDependencies> = {},
): AppDependencies {
  const defaultResult: ControlResult = {
    ok: true,
    sessionId: "mock-session-id",
  };

  const mockTransport: Transport = {
    handleOpen: () => {},
    handleMessage: () => {},
    handleClose: () => {},
    broadcastLifecycleEvent: () => {},
    getClientCount: () => 0,
    getSessionSubscriberCount: () => 0,
    shutdown: () => {},
  };

  return {
    scanner: {
      scanProjects: async () => [],
      scanSessions: async () => [],
      groupProjects: () => [],
      scanWorktrees: async () => [],
    },
    parser: {
      parseFullSession: () => createEmptyEnrichedSession(),
    },
    controller: {
      startSession: async () => defaultResult,
      stopSession: async () => defaultResult,
      resumeSession: async () => defaultResult,
      sendMessage: async () => defaultResult,
    },
    preferences: {
      readPreferences: async () => ({ projects: [] }),
      writePreferences: async () => {},
    },
    transport: mockTransport,
    basePaths: ["/mock/base/path"],
    staticDir: null,
    ...overrides,
  };
}

/** Creates a minimal valid ProjectSummary for testing. */
export function createMockProject(
  overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
  return {
    id: "-Users-test-project",
    source: "/mock/base/path",
    path: "/Users/test/project",
    sessionCount: 0,
    lastActiveAt: null,
    ...overrides,
  };
}

/** Creates a minimal valid SessionSummary for testing. */
export function createMockSession(
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    firstPrompt: null,
    model: null,
    startedAt: null,
    lastActiveAt: null,
    cwd: null,
    gitBranch: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cost: 0,
    ...overrides,
  };
}

/** Creates an empty EnrichedSession for testing. */
export function createEmptyEnrichedSession(): EnrichedSession {
  return {
    messages: [],
    turns: [],
    responses: [],
    toolCalls: [],
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      toolUseCount: 0,
    },
    toolStats: [],
    subagents: [],
    contextSnapshots: [],
  };
}
