"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { linkedAccountsQueryKey } from "@/lib/linked-accounts-query-key";
import { useAuthStore } from "@/lib/stores";
import { unwrapAuthResult } from "@/lib/unwrap-auth-result";

/** RNX-78: disconnects Google or GitHub (Better Auth's unlink-account; it refuses the last sign-in method). */
export function useUnlinkAccount() {
  const queryClient = useQueryClient();
  const { email } = useAuthStore();
  return useMutation({
    mutationFn: async (providerId: string) => unwrapAuthResult(await authClient.unlinkAccount({ providerId })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkedAccountsQueryKey(email) }),
    onError: (error: Error) => toast.error(error.message),
  });
}
