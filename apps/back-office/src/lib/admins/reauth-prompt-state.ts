import type { ReauthCredentials } from "./reauth-credentials";

/** The open re-authentication prompt: what it shows and how it answers. */
export type ReauthPromptState = {
  /** The API's refusal of the last attempt (e.g. wrong code), null before the first. */
  readonly error: string | null;
  readonly isSubmitting: boolean;
  readonly submit: (credentials: ReauthCredentials) => void;
  readonly cancel: () => void;
};
