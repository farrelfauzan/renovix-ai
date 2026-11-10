/** RNX-283: one tool call of a model reply, as the provider returns it (the arguments are a JSON string, not yet checked). */
export type ChatToolCall = {
  readonly id: string;
  readonly function: { readonly name: string; readonly arguments: string };
};
