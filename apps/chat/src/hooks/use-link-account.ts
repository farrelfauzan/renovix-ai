"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { signInSecurityUrl } from "@/lib/sign-in-security-url";
import { unwrapAuthResult } from "@/lib/unwrap-auth-result";

/** The providers a user can link (lib/auth.ts socialProviders). */
export type LinkableProvider = "google" | "github";

/**
 * RNX-78: connects Google or GitHub (Better Auth's link-social). The browser goes to the provider and comes back to
 * this page; a refusal (a different email among them) comes back as the `error` query parameter.
 */
export function useLinkAccount() {
  return useMutation({
    mutationFn: async (provider: LinkableProvider) =>
      unwrapAuthResult(
        await authClient.linkSocial({ provider, callbackURL: signInSecurityUrl(), errorCallbackURL: signInSecurityUrl() }),
      ),
    onError: (error: Error) => toast.error(error.message),
  });
}
