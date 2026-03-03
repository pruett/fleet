#!/usr/bin/env bun

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: fleet [options]

Options:
  -p, --port <number>       Server listen port (default: 3000)
  --base-paths <paths>      Comma-separated paths to scan for session data
                            (default: ~/.claude/projects)
  -v, --version             Show version number
  -h, --help                Show this help message
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  const pkg = await Bun.file(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
  ).json();
  console.log(pkg.version);
  process.exit(0);
}

function flag(name: string, short?: string): string | undefined {
  const idx = args.findIndex((a) => a === name || (short && a === short));
  return idx !== -1 ? args[idx + 1] : undefined;
}

const port = flag("--port", "-p");
if (port) process.env.FLEET_PORT = port;

const basePaths = flag("--base-paths");
if (basePaths) process.env.FLEET_BASE_PATHS = basePaths;

const __dirname = dirname(fileURLToPath(import.meta.url));
process.env.FLEET_STATIC_DIR = resolve(__dirname, "..", "client", "dist");

await import("../src/main.ts");
