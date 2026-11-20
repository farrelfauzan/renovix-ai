"use client";

import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { SettingsTextField } from "@/components/settings/general/settings-text-field";
import { useChangePassword } from "@/hooks/use-change-password";
import { PASSWORD_LIMITS } from "@/lib/password-limits";

/** RNX-78: the password change form: the current password is required (Better Auth refuses the change without it). */
export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const canSave = Boolean(currentPassword) && newPassword.length >= PASSWORD_LIMITS.minLength && !changePassword.isPending;
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    changePassword.mutate({ currentPassword, newPassword }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <SettingsTextField
        id="settings-current-password"
        label="Current password"
        hint="Needed to change it."
        type="password"
        value={currentPassword}
        maxLength={PASSWORD_LIMITS.maxLength}
        onChange={setCurrentPassword}
      />
      <SettingsTextField
        id="settings-new-password"
        label="New password"
        hint={`At least ${PASSWORD_LIMITS.minLength} characters.`}
        type="password"
        value={newPassword}
        maxLength={PASSWORD_LIMITS.maxLength}
        onChange={setNewPassword}
      />
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {changePassword.isPending ? "Saving..." : "Change password"}
        </Button>
      </div>
    </form>
  );
}
