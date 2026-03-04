export interface ControlResult {
  ok: boolean;
  sessionId: string;
  error?: string;
}

export interface StartSessionOpts {
  projectDir: string;
  prompt?: string;
  cwd?: string;
}
