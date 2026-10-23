import type { MoneyFigures } from "./money-figures";

/**
 * Cost, revenue and profit of one day, provider record, model, tier, wallet and package (RNX-228, profit:read).
 * `providerId` is "no provider record" for the calls without one. A wallet other than paid (weekly_free) has no revenue.
 */
export type ProfitReportRow = MoneyFigures & {
  readonly day: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly tier: string;
  readonly wallet: string;
  readonly packageVersionId: string | null;
  readonly topUpPackVersionId: string | null;
};
