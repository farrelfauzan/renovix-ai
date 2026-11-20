import type { CreditMeter } from "@/hooks/use-credit-meter";

/** D352 (10): a free user is one with no paid credits available. */
export const isFreeCreditUser = (meter: CreditMeter): boolean => Number(meter.paidAvailable) <= 0;
