"use client";

import { useState } from "react";
import { KeyRound, Pencil } from "lucide-react";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";
import { ChangePasswordForm } from "@/components/settings/sign-in-security/change-password-form";
import { SetPasswordForm } from "@/components/settings/sign-in-security/set-password-form";
import { SignInSecurityRow } from "@/components/settings/sign-in-security/sign-in-security-row";

/**
 * RNX-78: "Change" for an account with a password; "Set a password" for one that signed up with Google or GitHub
 * only (it has no password to change).
 */
export function PasswordRow({ hasPassword }: { hasPassword: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const close = () => setIsEditing(false);
  return (
    <SignInSecurityRow
      label="Password"
      detail={hasPassword ? "You can sign in with your email and password." : "You sign in with Google or GitHub. Set a password to also sign in with your email."}
      action={
        isEditing ? null : (
          <IconActionButton title={hasPassword ? "Change" : "Set a password"} icon={hasPassword ? Pencil : KeyRound} onClick={() => setIsEditing(true)} />
        )
      }
    >
      {isEditing && hasPassword ? <ChangePasswordForm onDone={close} /> : null}
      {isEditing && !hasPassword ? <SetPasswordForm onDone={close} /> : null}
    </SignInSecurityRow>
  );
}
