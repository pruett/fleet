import { describe, expect, it, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { watchProjectsDir, type ProjectsDirWatcher } from "../watch-projects-dir";

/** Promise-based delay for waiting on debounced timers in tests. */
function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A valid UUID v4 for use in tests. */
const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_UUID_2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

/** Create an empty .jsonl file so seedKnownSessions picks it up. */
async function seedFile(dir: string, sessionId: string, subdir?: string): Promise<void> {
  const target = subdir ? join(dir, subdir) : dir;
  await mkdir(target, { recursive: true });
  await writeFile(join(target, `${sessionId}.jsonl`), "");
}

describe("watchProjectsDir", () => {
  let tmpDir: string | null = null;
  let watcher: ProjectsDirWatcher | null = null;

  afterEach(async () => {
    watcher?.stop();
    watcher = null;
    if (tmpDir) await rm(tmpDir, { recursive: true });
    tmpDir = null;
  });

  it("fires onNewSession for a previously unseen session", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const newSessions: string[] = [];
    const activitySessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: (id) => newSessions.push(id),
      onSessionActivity: (id) => activitySessions.push(id),
      debounceMs: 50,
    });

    watcher._handleFileChange(`${VALID_UUID}.jsonl`);

    // onNewSession fires immediately (no debounce)
    expect(newSessions).toEqual([VALID_UUID]);
    expect(activitySessions).toHaveLength(0);
  });

  it("fires onSessionActivity for a known session", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));
    await seedFile(tmpDir, VALID_UUID);

    const newSessions: string[] = [];
    const activitySessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: (id) => newSessions.push(id),
      onSessionActivity: (id) => activitySessions.push(id),
      debounceMs: 50,
    });

    watcher._handleFileChange(`${VALID_UUID}.jsonl`);

    await waitMs(100);

    expect(newSessions).toHaveLength(0);
    expect(activitySessions).toEqual([VALID_UUID]);
  });

  it("seeds known sessions from existing files in subdirectories", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));
    await seedFile(tmpDir, VALID_UUID, "project-a");
    await seedFile(tmpDir, VALID_UUID_2, "project-b");

    const newSessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: (id) => newSessions.push(id),
      onSessionActivity: () => {},
      debounceMs: 50,
    });

    expect(watcher._knownSessions.has(VALID_UUID)).toBe(true);
    expect(watcher._knownSessions.has(VALID_UUID_2)).toBe(true);

    // Both are known, so changes fire activity not new
    watcher._handleFileChange(`project-a/${VALID_UUID}.jsonl`);
    watcher._handleFileChange(`project-b/${VALID_UUID_2}.jsonl`);

    expect(newSessions).toHaveLength(0);
  });

  it("transitions from new to activity on subsequent changes", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const newSessions: string[] = [];
    const activitySessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: (id) => newSessions.push(id),
      onSessionActivity: (id) => activitySessions.push(id),
      debounceMs: 50,
    });

    // First change: new
    watcher._handleFileChange(`${VALID_UUID}.jsonl`);
    expect(newSessions).toEqual([VALID_UUID]);

    // Second change: activity
    watcher._handleFileChange(`${VALID_UUID}.jsonl`);
    await waitMs(100);
    expect(activitySessions).toEqual([VALID_UUID]);
  });

  it("handles relative paths with subdirectories", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const newSessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: (id) => newSessions.push(id),
      onSessionActivity: () => {},
      debounceMs: 50,
    });

    watcher._handleFileChange(`project-a/${VALID_UUID}.jsonl`);
    expect(newSessions).toEqual([VALID_UUID]);
  });

  it("ignores non-.jsonl files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const newSessions: string[] = [];
    const activitySessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: (id) => newSessions.push(id),
      onSessionActivity: (id) => activitySessions.push(id),
      debounceMs: 50,
    });

    watcher._handleFileChange(`${VALID_UUID}.txt`);
    watcher._handleFileChange(`${VALID_UUID}.json`);
    watcher._handleFileChange(`${VALID_UUID}.log`);

    await waitMs(100);

    expect(newSessions).toHaveLength(0);
    expect(activitySessions).toHaveLength(0);
  });

  it("ignores .jsonl files whose stem is not a UUID v4", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const newSessions: string[] = [];
    const activitySessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: (id) => newSessions.push(id),
      onSessionActivity: (id) => activitySessions.push(id),
      debounceMs: 50,
    });

    watcher._handleFileChange("not-a-uuid.jsonl");
    watcher._handleFileChange("12345.jsonl");
    watcher._handleFileChange("summary.jsonl");

    await waitMs(100);

    expect(newSessions).toHaveLength(0);
    expect(activitySessions).toHaveLength(0);
  });

  it("ignores null filenames", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const newSessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: (id) => newSessions.push(id),
      onSessionActivity: () => {},
      debounceMs: 50,
    });

    watcher._handleFileChange(null);

    await waitMs(100);

    expect(newSessions).toHaveLength(0);
  });

  it("debounces rapid activity events for the same session into one callback", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));
    await seedFile(tmpDir, VALID_UUID);

    const activitySessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: () => {},
      onSessionActivity: (id) => activitySessions.push(id),
      debounceMs: 100,
    });

    // Fire 5 events in rapid succession
    for (let i = 0; i < 5; i++) {
      watcher._handleFileChange(`${VALID_UUID}.jsonl`);
    }

    await waitMs(200);

    expect(activitySessions).toEqual([VALID_UUID]);
  });

  it("debounces independently per sessionId", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));
    await seedFile(tmpDir, VALID_UUID);
    await seedFile(tmpDir, VALID_UUID_2);

    const activitySessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: () => {},
      onSessionActivity: (id) => activitySessions.push(id),
      debounceMs: 50,
    });

    watcher._handleFileChange(`${VALID_UUID}.jsonl`);
    watcher._handleFileChange(`${VALID_UUID_2}.jsonl`);

    await waitMs(100);

    expect(activitySessions).toContain(VALID_UUID);
    expect(activitySessions).toContain(VALID_UUID_2);
    expect(activitySessions).toHaveLength(2);
  });

  it("skips non-existent base paths without crashing", () => {
    watcher = watchProjectsDir({
      basePaths: ["/this/path/does/not/exist"],
      onNewSession: () => {},
      onSessionActivity: () => {},
      debounceMs: 50,
    });

    expect(watcher._knownSessions.size).toBe(0);
  });

  it("stop() cancels pending timers and prevents future callbacks", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));
    await seedFile(tmpDir, VALID_UUID);

    const activitySessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: () => {},
      onSessionActivity: (id) => activitySessions.push(id),
      debounceMs: 200,
    });

    watcher._handleFileChange(`${VALID_UUID}.jsonl`);

    await waitMs(50);
    watcher.stop();
    watcher = null;

    await waitMs(300);

    expect(activitySessions).toHaveLength(0);
  });

  it("debounce resets when events arrive within the window", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));
    await seedFile(tmpDir, VALID_UUID);

    const activitySessions: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onNewSession: () => {},
      onSessionActivity: (id) => activitySessions.push(id),
      debounceMs: 100,
    });

    watcher._handleFileChange(`${VALID_UUID}.jsonl`);

    await waitMs(70);
    expect(activitySessions).toHaveLength(0);
    watcher._handleFileChange(`${VALID_UUID}.jsonl`);

    await waitMs(70);
    expect(activitySessions).toHaveLength(0);

    await waitMs(100);
    expect(activitySessions).toEqual([VALID_UUID]);
  });
});
