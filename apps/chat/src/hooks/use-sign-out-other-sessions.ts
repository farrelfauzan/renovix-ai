"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { activeSessionsQueryKey } from "@/lib/active-sessions-query-key";
import { useAuthStore } from "@/lib/stores";
import { unwrapAuthResult } from "@/lib/unwrap-auth-result";

/** RNX-78: ends every other session of this account (Better Auth's revoke-other-sessions); refused at once by the API. */
export function useSignOutOtherSessions() {
  const queryClient = useQueryClient();
  const { email } = useAuthStore();
  return useMutation({
    mutationFn: async () => unwrapAuthResult(await authClient.revokeOtherSessions()),
    onSuccess: () => {
      toast.success("Signed out of your other devices");
      return queryClient.invalidateQueries({ queryKey: activeSessionsQueryKey(email) });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
