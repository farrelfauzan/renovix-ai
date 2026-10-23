"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SignedOutError } from "@/lib/api/signed-out-error";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { describeFailure } from "@/lib/sign-in/describe-failure";

/**
 * The forced password change (RX-95): the only screen a password-change session reaches. The new password
 * goes to the API, which starts a full session; then the overview. Sign-out works from here too. A refusal
 * shows the API's message. `api` is replaced in tests only.
 */
export function ChangePasswordScreen({ api = defaultSessionApi }: { api?: SessionApi }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const run = async (task: () => Promise<void>, next: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await task();
      router.replace(next);
    } catch (err) {
      if (err instanceof SignedOutError) router.replace("/sign-in");
      else setError(describeFailure(err));
    } finally {
      setIsSubmitting(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(() => api.changePassword(newPassword), "/");
  };
  return (
    <div className="mt-4 flex max-w-sm flex-col gap-4">
      <p className="text-sm">An owner asked you to set a new password before you continue.</p>
      <form aria-label="Change password" onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          New password
          <input type="password" name="newPassword" autoComplete="new-password" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1" />
        </label>
        <button type="submit" disabled={isSubmitting} className="self-start rounded-rx border border-rx-line px-3 py-1 text-sm">
          Change password
        </button>
      </form>
      <button type="button" disabled={isSubmitting} onClick={() => run(api.signOut, "/sign-in")} className="self-start text-sm underline">
        Sign out
      </button>
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
    </div>
  );
}
