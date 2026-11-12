"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import type { ReauthPromptState } from "@/lib/admins/reauth-prompt-state";

/** Asks for the password and a fresh TOTP code before a sensitive action (the API requires both); shows its refusal. */
export function ReauthPrompt({ prompt }: { prompt: ReauthPromptState }) {
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || !totp) return;
    prompt.submit({ password, totp });
    setTotp("");
  };
  return (
    <form role="dialog" aria-label="Confirm it is you" onSubmit={submit} className="mt-4 flex max-w-sm flex-col gap-3 rounded-rx border border-rx-line p-4">
      <p className="text-sm">This action needs a fresh confirmation. Enter your password and the current code of your authenticator app.</p>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <Input type="password" name="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1 h-auto text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Authenticator code
        <Input type="text" name="totp" autoComplete="one-time-code" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={totp} onChange={(event) => setTotp(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1 h-auto text-sm" />
      </label>
      {prompt.error && <p role="alert" className="text-sm text-rx-red-bar">{prompt.error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" type="submit" disabled={prompt.isSubmitting} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Confirm</Button>
        <Button variant="outline" type="button" onClick={prompt.cancel} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Cancel</Button>
      </div>
    </form>
  );
}
