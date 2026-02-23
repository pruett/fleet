/**
 * Temp file utilities for watcher tests.
 * Creates disposable .jsonl files and provides append helpers.
 */

import { mkdtemp, rm, appendFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export interface TempJsonl {
  /** Absolute path to the temp .jsonl file. */
  path: string;
  /** Remove the temp directory and its contents. */
  cleanup: () => Promise<void>;
}

/** Create an empty temp .jsonl file. Returns path and cleanup function. */
export async function createTempJsonl(): Promise<TempJsonl> {
  const dir = await mkdtemp(join(tmpdir(), "fleet-watcher-test-"));
  const path = join(dir, "session.jsonl");
  await Bun.write(path, "");
  return {
    path,
    cleanup: () => rm(dir, { recursive: true }),
  };
}

/** Append one or more JSONL lines to a file (each terminated with \n). */
export async function appendLines(path: string, lines: string[]): Promise<void> {
  await appendFile(path, lines.map((l) => l + "\n").join(""));
}

/** Append raw text to a file (no automatic newline). */
export async function appendRaw(path: string, text: string): Promise<void> {
  await appendFile(path, text);
}
