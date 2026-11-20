"use client";

import { useState } from "react";
import { Badge } from "@performa-ai/ui/components/badge";
import { Button } from "@performa-ai/ui/components/button";
import { SettingsTextField } from "@/components/settings/general/settings-text-field";
import { SignInSecurityRow } from "@/components/settings/sign-in-security/sign-in-security-row";
import type { CurrentUser } from "@/hooks/use-current-user";
import { useChangeEmail } from "@/hooks/use-change-email";

/** The longest email Better Auth's change-email accepts in practice (RFC 5321 path limit). */
const EMAIL_MAX_LENGTH = 254;

/**
 * RNX-78: the sign-in email and "Change". A change sends a confirmation link to the new address; the email shown here
 * stays the old one until that link is opened.
 */
export function EmailRow({ user }: { user: CurrentUser }) {
  const changeEmail = useChangeEmail();
  const [isEditing, setIsEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    changeEmail.mutate(email, {
      onSuccess: () => {
        setSentTo(email);
        setIsEditing(false);
        setNewEmail("");
      },
    });
  };
  return (
    <SignInSecurityRow
      label="Email"
      detail={
        <span className="inline-flex flex-wrap items-center gap-2">
          {user.email}
          <Badge variant={user.emailVerified ? "secondary" : "outline"}>{user.emailVerified ? "verified" : "not verified"}</Badge>
        </span>
      }
      action={
        isEditing ? null : (
          <Button type="button" variant="outline" onClick={() => setIsEditing(true)}>
            Change
          </Button>
        )
      }
    >
      {sentTo ? (
        <p role="status" className="text-[13px]">
          We sent a link to {sentTo}. Your email changes when you open it.
        </p>
      ) : null}
      {isEditing ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <SettingsTextField
            id="settings-new-email"
            label="New email"
            hint="We send a confirmation link to this address. Until you open it, you keep signing in with your current email."
            type="email"
            value={newEmail}
            maxLength={EMAIL_MAX_LENGTH}
            onChange={setNewEmail}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!newEmail.trim() || changeEmail.isPending}>
              {changeEmail.isPending ? "Sending..." : "Send confirmation link"}
            </Button>
          </div>
        </form>
      ) : null}
    </SignInSecurityRow>
  );
}
