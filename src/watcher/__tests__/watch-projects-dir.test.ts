import { describe, expect, it, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
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

describe("watchProjectsDir", () => {
  let tmpDir: string | null = null;
  let watcher: ProjectsDirWatcher | null = null;

  afterEach(async () => {
    watcher?.stop();
    watcher = null;
    if (tmpDir) await rm(tmpDir, { recursive: true });
    tmpDir = null;
  });

  it("fires onSessionActivity for a valid UUID .jsonl filename", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const received: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 50,
    });

    // Simulate a file change event via the internal handler
    watcher._handleFileChange(`${VALID_UUID}.jsonl`);

    // Wait for debounce to fire
    await waitMs(100);

    expect(received).toEqual([VALID_UUID]);
  });

  it("handles relative paths with subdirectories", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const received: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 50,
    });

    // fs.watch with recursive:true gives relative paths like "project-a/session.jsonl"
    watcher._handleFileChange(`project-a/${VALID_UUID}.jsonl`);

    await waitMs(100);

    expect(received).toEqual([VALID_UUID]);
  });

  it("ignores non-.jsonl files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const received: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 50,
    });

    watcher._handleFileChange(`${VALID_UUID}.txt`);
    watcher._handleFileChange(`${VALID_UUID}.json`);
    watcher._handleFileChange(`${VALID_UUID}.log`);

    await waitMs(100);

    expect(received).toHaveLength(0);
  });

  it("ignores .jsonl files whose stem is not a UUID v4", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const received: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 50,
    });

    watcher._handleFileChange("not-a-uuid.jsonl");
    watcher._handleFileChange("12345.jsonl");
    watcher._handleFileChange("summary.jsonl");

    await waitMs(100);

    expect(received).toHaveLength(0);
  });

  it("ignores null filenames", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const received: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 50,
    });

    watcher._handleFileChange(null);

    await waitMs(100);

    expect(received).toHaveLength(0);
  });

  it("debounces rapid events for the same session into one callback", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const received: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 100,
    });

    // Fire 5 events in rapid succession
    for (let i = 0; i < 5; i++) {
      watcher._handleFileChange(`${VALID_UUID}.jsonl`);
    }

    // Wait for debounce to settle
    await waitMs(200);

    // Coalesced into exactly one callback
    expect(received).toEqual([VALID_UUID]);
  });

  it("debounces independently per sessionId", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const received: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 50,
    });

    watcher._handleFileChange(`${VALID_UUID}.jsonl`);
    watcher._handleFileChange(`${VALID_UUID_2}.jsonl`);

    await waitMs(100);

    expect(received).toContain(VALID_UUID);
    expect(received).toContain(VALID_UUID_2);
    expect(received).toHaveLength(2);
  });

  it("skips non-existent base paths without crashing", () => {
    const received: string[] = [];

    // Should not throw even with a non-existent path
    watcher = watchProjectsDir({
      basePaths: ["/this/path/does/not/exist"],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 50,
    });

    expect(received).toHaveLength(0);
  });

  it("stop() cancels pending timers and prevents future callbacks", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const received: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 200,
    });

    // Fire an event to start the debounce timer
    watcher._handleFileChange(`${VALID_UUID}.jsonl`);

    // Stop before the debounce fires
    await waitMs(50);
    watcher.stop();
    watcher = null;

    // Wait past the debounce window
    await waitMs(300);

    // The callback should never have fired
    expect(received).toHaveLength(0);
  });

  it("debounce resets when events arrive within the window", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fleet-wpd-test-"));

    const received: string[] = [];
    watcher = watchProjectsDir({
      basePaths: [tmpDir],
      onSessionActivity: (id) => received.push(id),
      debounceMs: 100,
    });

    // First event
    watcher._handleFileChange(`${VALID_UUID}.jsonl`);

    // Wait 70ms (within the 100ms debounce window), then fire again
    await waitMs(70);
    expect(received).toHaveLength(0); // not yet fired
    watcher._handleFileChange(`${VALID_UUID}.jsonl`);

    // Wait another 70ms — still within the reset window
    await waitMs(70);
    expect(received).toHaveLength(0); // still not fired (timer was reset)

    // Wait for the debounce to fully settle
    await waitMs(100);
    expect(received).toEqual([VALID_UUID]);
  });
});
