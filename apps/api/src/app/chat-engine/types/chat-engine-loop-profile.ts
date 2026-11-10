/**
 * RNX-283: how the tool loop behaves for one source, as that source's legacy loop does today (docs/testing.md,
 * "Run-loop scenario index (RNX-16)"): the engine keeps each source's own behaviour instead of choosing one.
 */
export type ChatEngineLoopProfile = {
  /** Model rounds before the loop stops with `maxStepsMessage`. */
  readonly maxIterations: number;
  /** Rounds a call_agent attempt adds on top of its round (the agent run counts it 3 in all). */
  readonly agentCallExtraIterations: number;
  /** Whether an answer cut at max_tokens (`finish_reason: "length"`) is continued and joined, or taken as final. */
  readonly continuesOnLength: boolean;
  /** The characters of a tool result the model gets back (the rest is cut), or null to pass it whole. */
  readonly toolResultMaxChars: number | null;
  /** Whether a response without a choice fails the run, or ends the loop with `maxStepsMessage`. */
  readonly throwsOnMissingChoice: boolean;
  /** The answer when the loop stops at its limit (or, when it does not throw, on a response without a choice). */
  readonly maxStepsMessage: string;
};
