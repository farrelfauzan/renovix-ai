"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { linkedAccountsQueryKey } from "@/lib/linked-accounts-query-key";
import { useAuthStore } from "@/lib/stores";

/**
 * RNX-78: a first password for an account that signed up with Google or GitHub (POST /auth/password). The sign-in
 * methods are read again so the page shows "Change" afterwards. A refusal's toast is the api-client's.
 */
export function useSetPassword() {
  const queryClient = useQueryClient();
  const { email } = useAuthStore();
  return useMutation({
    mutationFn: (newPassword: string) => apiClient.post<void>("/auth/password", { newPassword }),
    onSuccess: () => {
      toast.success("Password set. You can now sign in with your email and password.");
      return queryClient.invalidateQueries({ queryKey: linkedAccountsQueryKey(email) });
    },
  });
}
