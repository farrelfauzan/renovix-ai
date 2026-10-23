import type { MoneyFigures } from "./money-figures";

/** One row of `GET /admin/usage/profit` (RNX-228): a day, provider, model, tier, wallet and package. A wallet other than paid has no revenue. */
export type ProfitReportRow = MoneyFigures & {
  readonly day: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly tier: string;
  readonly wallet: string;
  readonly packageVersionId: string | null;
  readonly topUpPackVersionId: string | null;
};
