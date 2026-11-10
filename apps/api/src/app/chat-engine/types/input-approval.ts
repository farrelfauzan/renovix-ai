/** The input guardrail's verdict as the engine uses it: rejected with the decline message, or approved with the text that goes onward. */
export type InputApproval = { readonly rejected: true; readonly message: string } | { readonly rejected: false; readonly input: string };
