/**
 * RNX-118: an agent the running agent may call with `call_agent` (a linked callee in its workspace), with what the
 * one-hop call and the run's pre-run estimate (LinkedAgent, docs/credits.md section 13.3) read.
 */
export type CallableAgent = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly model: string;
  readonly systemPrompt: string;
  readonly temperature: number;
  readonly maxTokens: number | null;
  readonly workspaceId: string;
};
