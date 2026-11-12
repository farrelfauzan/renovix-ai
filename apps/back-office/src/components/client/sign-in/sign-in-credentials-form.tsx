"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";

/** First step of the sign-in (RX-94): email and password. Nothing is sent yet: the API takes them with the second factor. */
export function SignInCredentialsForm({ email: initialEmail, onContinue }: { email: string; onContinue: (email: string, password: string) => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onContinue(email, password);
  };
  return (
    <form aria-label="Email and password" onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <Input type="email" name="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1 h-auto text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <Input type="password" name="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1 h-auto text-sm" />
      </label>
      <Button variant="outline" type="submit" className="self-start rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">
        Continue
      </Button>
    </form>
  );
}
