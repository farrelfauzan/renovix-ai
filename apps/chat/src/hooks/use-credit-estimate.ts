"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { creditEstimateQueryKey } from "@/lib/credit-estimate-query-key";
import { ESTIMATED_TIERS } from "@/lib/estimated-tiers";
import { useAuthStore, useHydrated } from "@/lib/stores";

/** The most credits the reservation of a message would hold (POST /chat/portal/credit-estimate); a decimal string. */
export interface CreditEstimate {
  credits: string;
}

/** How long the composer text must stay unchanged before an estimate is requested: at most one request per pause in typing. */
const ESTIMATE_DEBOUNCE_MS = 600;

interface UseCreditEstimateInput {
  model: string | null;
  tier: string | undefined;
  history: readonly { role: string; content: string }[];
  input: string;
}

/**
 * "Up to N credits" for the message being composed, from the API (the same worst case the reservation holds). The
 * figure depends on the message text, so the request waits for a pause in typing. Requested only for a Premium or
 * Frontier model, a signed-in user and a non-empty message; never for any other tier.
 */
export function useCreditEstimate({ model, tier, history, input }: UseCreditEstimateInput) {
  const { email, isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  const [pausedInput, setPausedInput] = useState(input);
  useEffect(() => {
    const timer = setTimeout(() => setPausedInput(input), ESTIMATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);
  const text = pausedInput.trim();
  const messages = useMemo(() => [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: text }], [history, text]);
  const isEstimated = !!model && !!tier && ESTIMATED_TIERS.includes(tier) && text.length > 0;
  return useQuery<CreditEstimate>({
    queryKey: creditEstimateQueryKey(email, model ?? "", messages),
    queryFn: () => apiClient.post<CreditEstimate>("/chat/portal/credit-estimate", { model, messages }),
    enabled: hydrated && isLoggedIn() && isEstimated,
    staleTime: Infinity,
    retry: false,
  });
}
