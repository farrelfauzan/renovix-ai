"use client";

import { CircleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { AuthenticatorCodeInput } from "@/components/client/form/authenticator-code-input";
import type { ReauthPromptState } from "@/lib/admins/reauth-prompt-state";
import { AUTHENTICATOR_CODE_LENGTH } from "@/lib/sign-in/authenticator-code-length";

/** Asks for the password and a fresh TOTP code (six boxes, RNX-332) before a sensitive action (the API requires both); shows its refusal. */
export function ReauthPrompt({ prompt }: { prompt: ReauthPromptState }) {
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || totp.length < AUTHENTICATOR_CODE_LENGTH) return;
    prompt.submit({ password, totp });
    setTotp("");
  };
  return (
    <form role="dialog" aria-label="Confirm it is you" onSubmit={submit} className="mt-4 flex max-w-sm flex-col gap-2 rounded-rx border border-rx-line p-3">
      <p className="text-[13px]">This action needs a fresh confirmation. Enter your password and the current code of your authenticator app.</p>
      <label className="flex flex-col">
        <span className="sr-only">Password</span>
        <Input type="password" name="password" autoComplete="current-password" placeholder="Password" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 rounded-rx border-rx-line bg-rx-white px-3 text-[15px] md:text-[15px]" />
      </label>
      <AuthenticatorCodeInput value={totp} onChange={setTotp} />
      {prompt.error && (
        <p role="alert" className="flex items-start gap-2.5 rounded-rx bg-rx-red-tint px-3 py-2.5 text-[13px] text-rx-red-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-rx-red-bar" />
          {prompt.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" type="button" onClick={prompt.cancel} className="h-11 flex-1 rounded-rx border-rx-line bg-rx-white text-rx-ink hover:border-rx-ink hover:bg-rx-white hover:text-rx-ink">Cancel</Button>
        <Button type="submit" disabled={prompt.isSubmitting} className="h-11 flex-1 rounded-rx bg-rx-accent text-rx-on-accent hover:bg-rx-accent-hover">Confirm</Button>
      </div>
    </form>
  );
}
