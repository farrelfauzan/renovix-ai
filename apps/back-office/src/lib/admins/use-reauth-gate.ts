import { useCallback, useState } from "react";
import { RefusedError } from "@/lib/sign-in/refused-error";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { ActionOutcome } from "./action-outcome";
import type { ReauthCredentials } from "./reauth-credentials";
import { ReauthRequiredError } from "./reauth-required-error";
import type { ReauthPromptState } from "./reauth-prompt-state";

const CANCELLED_MESSAGE = "Re-authentication was cancelled.";

function toFailure(error: unknown): ActionOutcome<never> {
  return { ok: false, message: describeFailure(error), status: error instanceof RefusedError ? error.status : undefined };
}

/**
 * Runs an action; when the API answers "Re-authentication required", opens a prompt (password + TOTP), sends
 * the reauth, then retries the action ONCE. A refused reauth (wrong code) keeps the prompt open with the API's
 * message and the action is not retried; cancelling ends the action unchanged.
 */
export function useReauthGate(reauth: (credentials: ReauthCredentials) => Promise<void>) {
  const [prompt, setPrompt] = useState<ReauthPromptState | null>(null);
  const askForCredentials = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        const close = (isDone: boolean) => {
          setPrompt(null);
          resolve(isDone);
        };
        const open = (error: string | null, isSubmitting: boolean) =>
          setPrompt({
            error,
            isSubmitting,
            cancel: () => close(false),
            submit: async (credentials) => {
              open(null, true);
              try {
                await reauth(credentials);
                close(true);
              } catch (err) {
                open(describeFailure(err), false);
              }
            },
          });
        open(null, false);
      }),
    [reauth],
  );
  const perform = useCallback(
    async <T,>(action: () => Promise<T>): Promise<ActionOutcome<T>> => {
      try {
        return { ok: true, value: await action() };
      } catch (err) {
        if (!(err instanceof ReauthRequiredError)) return toFailure(err);
      }
      if (!(await askForCredentials())) return { ok: false, message: CANCELLED_MESSAGE };
      try {
        return { ok: true, value: await action() };
      } catch (err) {
        return toFailure(err);
      }
    },
    [askForCredentials],
  );
  return { perform, prompt };
}
