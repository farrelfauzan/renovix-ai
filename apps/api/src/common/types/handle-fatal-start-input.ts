/** RNX-233: what `handleFatalStart` needs: the startup error, the environment and the process exit (injected for tests). */
export interface HandleFatalStartInput {
  err: unknown;
  env: NodeJS.ProcessEnv;
  exit: (code: number) => void;
}
