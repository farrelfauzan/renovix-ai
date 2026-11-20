"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { unwrapAuthResult } from "@/lib/unwrap-auth-result";

/** The fields of a password change; Better Auth refuses it without the right current password. */
export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
}

/** RNX-78: changes the password (Better Auth's change-password, the current password required). */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (change: PasswordChange) => unwrapAuthResult(await authClient.changePassword(change)),
    onSuccess: () => toast.success("Password changed"),
    onError: (error: Error) => toast.error(error.message),
  });
}
