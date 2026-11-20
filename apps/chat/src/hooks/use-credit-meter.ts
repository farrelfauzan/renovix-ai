"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { creditMeterQueryKey } from "@/lib/credit-meter-query-key";
import { useAuthStore, useHydrated } from "@/lib/stores";

/** The paid wallet's projected run-out; `runOutLabel` is "DD/MM/YYYY HH:00" in the profile timezone. */
export type CreditMeterProjection =
  | { status: "date"; runOutAt: string; runOutLabel: string; timeZone: string }
  | { status: "not_enough_use" }
  | { status: "more_than_a_year" };

/** A scheduled run due before the run-out, listed in the red state. */
export interface CreditMeterReminder {
  id: string;
  description: string | null;
  nextRunAt: string;
}

/** The signed-in user's credit meter (GET /chat/portal/credit-meter); credit amounts are decimal strings. */
export interface CreditMeter {
  paidAvailable: string;
  weeklyFreeAvailable: string;
  projection: CreditMeterProjection;
  level: "none" | "amber" | "red";
  belowFloor: boolean;
  dueReminders: CreditMeterReminder[];
}

const REFETCH_INTERVAL_MS = 60000;

/** The signed-in user's credit meter, shared by the sidebar meter and the banner; never requested for anonymous visitors (it would 401). */
export function useCreditMeter() {
  const { email, isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  return useQuery<CreditMeter>({
    queryKey: creditMeterQueryKey(email),
    queryFn: () => apiClient.get<CreditMeter>("/chat/portal/credit-meter"),
    enabled: hydrated && isLoggedIn(),
    refetchInterval: REFETCH_INTERVAL_MS,
  });
}
