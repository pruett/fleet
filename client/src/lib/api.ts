import type {
  ProjectSummary,
  GroupedProject,
  SessionSummary,
  WorktreeSummary,
  EnrichedSession,
  FleetPreferences,
} from "@/types/api";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

/**
 * Fetch with automatic retry for 5xx errors.
 * - 5xx: retries up to `maxRetries` times with `retryDelayMs` between attempts
 * - 4xx: throws immediately (no retry)
 * - Network errors: retries (treated like 5xx)
 */
async function requestWithRetry<T>(
  path: string,
  init?: RequestInit,
  maxRetries = 3,
  retryDelayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await request<T>(path, init);
    } catch (err: unknown) {
      lastError = err;
      // 4xx errors — do not retry
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        throw err;
      }
      // 5xx or network error — retry if attempts remain
      if (attempt < maxRetries) {
        await delay(retryDelayMs);
      }
    }
  }
  throw lastError;
}

function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function fetchProjects(): Promise<GroupedProject[]> {
  const { projects } = await requestWithRetry<{ projects: GroupedProject[] }>(
    "/api/projects",
  );
  return projects;
}

export async function fetchDirectories(): Promise<ProjectSummary[]> {
  const { directories } = await requestWithRetry<{
    directories: ProjectSummary[];
  }>("/api/directories");
  return directories;
}

export async function fetchSessions(
  slug: string,
  limit?: number,
): Promise<SessionSummary[]> {
  const params = limit ? `?limit=${limit}` : "";
  const { sessions } = await requestWithRetry<{ sessions: SessionSummary[] }>(
    `/api/projects/${encodeURIComponent(slug)}/sessions${params}`,
  );
  return sessions;
}

export async function fetchWorktrees(
  projectId: string,
): Promise<WorktreeSummary[]> {
  const { worktrees } = await requestWithRetry<{
    worktrees: WorktreeSummary[];
  }>(`/api/projects/${encodeURIComponent(projectId)}/worktrees`);
  return worktrees;
}

export async function fetchSession(
  sessionId: string,
): Promise<EnrichedSession> {
  const { session } = await requestWithRetry<{ session: EnrichedSession }>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  return session;
}

export async function startSession(
  projectDir: string,
  opts?: { prompt?: string; cwd?: string },
): Promise<string> {
  const { sessionId } = await post<{ sessionId: string }>("/api/sessions", {
    projectDir,
    ...opts,
  });
  return sessionId;
}

export async function stopSession(sessionId: string): Promise<void> {
  await post(`/api/sessions/${encodeURIComponent(sessionId)}/stop`);
}

export async function resumeSession(sessionId: string): Promise<void> {
  await post(`/api/sessions/${encodeURIComponent(sessionId)}/resume`);
}

export async function sendMessage(
  sessionId: string,
  message: string,
): Promise<void> {
  await post(`/api/sessions/${encodeURIComponent(sessionId)}/message`, {
    message,
  });
}

export async function fetchPreferences(): Promise<FleetPreferences> {
  return requestWithRetry<FleetPreferences>("/api/preferences");
}

export async function updatePreferences(
  prefs: FleetPreferences,
): Promise<FleetPreferences> {
  return request<FleetPreferences>("/api/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export { ApiError };
