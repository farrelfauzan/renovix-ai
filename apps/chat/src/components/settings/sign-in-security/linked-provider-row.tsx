"use client";

import { Button } from "@performa-ai/ui/components/button";
import { SignInSecurityRow } from "@/components/settings/sign-in-security/sign-in-security-row";
import { type LinkableProvider, useLinkAccount } from "@/hooks/use-link-account";
import { useUnlinkAccount } from "@/hooks/use-unlink-account";

interface LinkedProviderRowProps {
  provider: LinkableProvider;
  label: string;
  isLinked: boolean;
  /** True when this is the account's only sign-in method: it cannot be disconnected (the API refuses it too). */
  isOnlyMethod: boolean;
}

/** RNX-78: Google or GitHub: Connect, or Disconnect unless it is the last way to sign in. */
export function LinkedProviderRow({ provider, label, isLinked, isOnlyMethod }: LinkedProviderRowProps) {
  const linkAccount = useLinkAccount();
  const unlinkAccount = useUnlinkAccount();
  const detail = !isLinked ? "Not connected" : isOnlyMethod ? "Connected · your only way to sign in, so it cannot be disconnected" : "Connected";
  return (
    <SignInSecurityRow
      label={label}
      detail={detail}
      action={
        isLinked ? (
          <Button type="button" variant="outline" disabled={isOnlyMethod || unlinkAccount.isPending} onClick={() => unlinkAccount.mutate(provider)}>
            Disconnect
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={linkAccount.isPending} onClick={() => linkAccount.mutate(provider)}>
            Connect
          </Button>
        )
      }
    />
  );
}
