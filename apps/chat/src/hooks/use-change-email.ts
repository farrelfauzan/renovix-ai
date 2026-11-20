"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { signInSecurityUrl } from "@/lib/sign-in-security-url";
import { unwrapAuthResult } from "@/lib/unwrap-auth-result";

/**
 * RNX-78: asks for an email change (Better Auth's change-email). The API queues a mail with a link to the new address;
 * the email changes only when that link is opened, which brings the browser back to this page.
 */
export function useChangeEmail() {
  return useMutation({
    mutationFn: async (newEmail: string) =>
      unwrapAuthResult(await authClient.changeEmail({ newEmail, callbackURL: signInSecurityUrl() })),
    onError: (error: Error) => toast.error(error.message),
  });
}
