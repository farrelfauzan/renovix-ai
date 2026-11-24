"use client";

import { useCreditEstimate } from "@/hooks/use-credit-estimate";
import { formatCreditEstimate } from "@/lib/format-credit-estimate";

type CreditEstimateHintProps = {
  model: string | null;
  tier: string | undefined;
  history: readonly { role: string; content: string }[];
  input: string;
};

/** "up to N credits" under the composer for a Premium or Frontier model (RNX-331); nothing for any other tier or while there is no figure. */
export function CreditEstimateHint({ model, tier, history, input }: CreditEstimateHintProps) {
  const { data: estimate } = useCreditEstimate({ model, tier, history, input });
  if (!estimate?.credits || !input.trim()) return null;
  return <span className="self-center text-[11px] text-muted-foreground">up to {formatCreditEstimate(estimate.credits)} credits</span>;
}
