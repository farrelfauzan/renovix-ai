"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";

/** First step of the sign-in (RX-94), the canvas's password card (RNX-332): email and password. Nothing is sent yet: the API takes them with the second factor. */
export function SignInCredentialsForm({ email: initialEmail, onContinue }: { email: string; onContinue: (email: string, password: string) => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onContinue(email, password);
  };
  return (
    <form aria-label="Email and password" onSubmit={submit} className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-[-0.01em]">Sign in</h1>
        <p className="text-[13px] text-rx-muted">Use the email your invitation was sent to.</p>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium">
        Email
        <Input type="email" name="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 rounded-rx border-rx-line bg-rx-white px-3 text-[15px] font-normal md:text-[15px]" />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium">
        Password
        <Input type="password" name="password" autoComplete="current-password" placeholder="At least 12 characters" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 rounded-rx border-rx-line bg-rx-white px-3 text-[15px] font-normal md:text-[15px]" />
      </label>
      <Button type="submit" className="h-11 w-full rounded-rx bg-rx-accent text-rx-on-accent hover:bg-rx-accent-hover">
        Continue
      </Button>
      <p className="text-xs text-rx-muted">No sign-up, no social login, no magic link.</p>
    </form>
  );
}
