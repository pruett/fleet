# Fleet

A companion dashboard for AI coding agents.


Fleet is a local dashboard that runs alongside your agent CLI(s). It reads session transcripts from disk, parses, and streams updates in real time — so you can easily search, monitor, inspect, and continue sessions from any device.

**Currently supported:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
**Coming soon:** Codex, OpenCode, and more

## Quick Start

```sh
bunx @pruett/fleet
```

Fleet starts a local server and opens your dashboard at `http://localhost:3000`. No configuration, no database, no API keys.

> **Prerequisite:** [Bun](https://bun.sh) >= 1.1

## Why Fleet?

**See what the model is actually doing.** AI coding agents are a black box. Scrolling through CLI output can only get you so far. Fleet cracks open the transcript and gives you a structured view of every turn — reasoning, tool calls, token usage, context window pressure — so you can understand the model's behavior and get better at steering it.

**Monitor and continue sessions from anywhere.** CLI agents tie you to your terminal while they run. Fleet puts your sessions behind a web UI. Pair it with [Tailscale](https://tailscale.com) or any network tunnel and you can check in on running sessions, review completed ones, and send follow-up messages from your phone, a tablet, or another machine.

## How It Works

Fleet is a local web app. No external services, no cloud dependencies — everything runs on your machine.

1. **Scans** configured directories for session transcript files (`.jsonl`)
2. **Parses** the raw JSONL into structured conversations with turns, tool calls, and metadata
3. **Watches** active transcript files for changes and streams updates to the dashboard via WebSocket
4. **Serves** a web dashboard that renders conversations with syntax highlighting, collapsible reasoning blocks, and analytics panels

## Configuration

Fleet works out of the box with zero configuration. All customization lives in a single config file:

```
~/.config/fleet/settings.json
```

Fleet creates this file automatically when you first customize your dashboard. You can also edit it by hand:

```jsonc
{
  "projects": [
    {
      "title": "My App",
      "projectIds": ["-Users-me-code-my-app"]
    },
    {
      "title": "Monorepo",
      "projectIds": ["-Users-me-code-monorepo-*"]
    }
  ]
}
```

| Field | Description |
|---|---|
| `projects` | Array of project groups to display in the dashboard |
| `projects[].title` | Display name for the project group |
| `projects[].projectIds` | Array of directory ID patterns (supports globs) to include in this group |

### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `-p, --port <number>` | `3000` | Server listen port |
| `--base-paths <paths>` | `~/.claude/projects` | Comma-separated paths to scan for session data |
| `-v, --version` | | Show version number |
| `-h, --help` | | Show help message |
