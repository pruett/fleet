// Public API
export { watchSession, stopWatching, stopAll } from "./watch-session";
export { watchProjectsDir } from "./watch-projects-dir";

// Types
export type {
  WatchOptions,
  WatchHandle,
  WatchBatch,
  WatchError,
} from "./types";
export type { ProjectsDirWatcher } from "./watch-projects-dir";
