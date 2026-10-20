/** An agent the root agent may call in a run (a sub-agent), as the pre-run estimate reads it (docs/credits.md section 13.3). */
export type LinkedAgent = {
  readonly model: string;
  readonly systemPrompt: string;
  readonly maxTokens: number | null;
};
