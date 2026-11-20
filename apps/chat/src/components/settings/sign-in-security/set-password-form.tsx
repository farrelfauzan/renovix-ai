"use client";

import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { SettingsTextField } from "@/components/settings/general/settings-text-field";
import { useSetPassword } from "@/hooks/use-set-password";
import { PASSWORD_LIMITS } from "@/lib/password-limits";

/** RNX-78: a first password for an account that signed up with Google or GitHub (POST /auth/password). */
export function SetPasswordForm({ onDone }: { onDone: () => void }) {
  const setPassword = useSetPassword();
  const [newPassword, setNewPassword] = useState("");
  const canSave = newPassword.length >= PASSWORD_LIMITS.minLength && !setPassword.isPending;
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setPassword.mutate(newPassword, { onSuccess: onDone });
  };
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <SettingsTextField
        id="settings-set-password"
        label="New password"
        hint={`At least ${PASSWORD_LIMITS.minLength} characters. You then sign in with your email and this password too.`}
        type="password"
        value={newPassword}
        maxLength={PASSWORD_LIMITS.maxLength}
        onChange={setNewPassword}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {setPassword.isPending ? "Saving..." : "Set password"}
        </Button>
      </div>
    </form>
  );
}
