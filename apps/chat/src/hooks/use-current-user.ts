"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { currentUserQueryKey } from "@/lib/current-user-query-key";
import { useAuthStore, useHydrated } from "@/lib/stores";

/** The signed-in user's profile (GET /auth/me), the fields the chat reads. */
export interface CurrentUser {
  id: string;
  email: string;
  /** RNX-78: whether the sign-in email has been confirmed (shown on Settings > Sign-in and security). */
  emailVerified: boolean;
  name: string | null;
  avatar: string | null;
  jobTitle: string | null;
  phone: string | null;
  /** RNX-77a: the role from the profile step or Settings > General. */
  role: string | null;
  /** RNX-77a: the model tier a new chat starts on, if the user chose one. */
  defaultModelTier: string | null;
  timezone: string | null;
  locale: string | null;
  country: string | null;
  signupGoal: string | null;
  profileCompletedAt: string | null;
  /** RNX-33: false until the profile step has been saved; the app is gated on it. */
  profileCompleted: boolean;
}

/** The signed-in user's profile; never requested for anonymous visitors (it would 401). */
export function useCurrentUser() {
  const { email, isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  return useQuery<CurrentUser>({
    queryKey: currentUserQueryKey(email),
    queryFn: () => apiClient.get<CurrentUser>("/auth/me"),
    enabled: hydrated && isLoggedIn(),
  });
}
