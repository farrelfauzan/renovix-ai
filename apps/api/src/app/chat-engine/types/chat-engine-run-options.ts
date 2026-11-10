/** RNX-282: how a caller controls a run besides its request (not request data, so not in the Zod schema): `signal` aborts it, in-flight work included. */
export type ChatEngineRunOptions = {
  readonly signal?: AbortSignal;
};
