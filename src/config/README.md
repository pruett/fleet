# Config Module

Reads and writes Fleet's user configuration (`~/.config/fleet/settings.json`).

## Public Interface

### Functions

- **`getConfigPath(): string`** — Returns the full path to the config file.
- **`readConfig(): Promise<FleetConfig>`** — Reads and parses the config file. Returns defaults on error. Handles legacy format migration.
- **`writeConfig(config: FleetConfig): Promise<void>`** — Writes config to file, creating parent directories as needed.

### Types

- **`FleetConfig`** — The full configuration object.
- **`ProjectConfig`** — Per-project configuration entry.
