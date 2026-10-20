/** The result of a guarded action: its value, or the text to show (the API's message) with the refusal's status. */
export type ActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly status?: number };
