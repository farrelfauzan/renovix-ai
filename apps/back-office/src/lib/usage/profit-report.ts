import type { CreditSalesView } from "./credit-sales-view";
import type { ProfitReportRow } from "./profit-report-row";
import type { ProfitTotals } from "./profit-totals";

/** The answer of `GET /admin/usage/profit` (RNX-228). */
export type ProfitReport = {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly ppnRate: string;
  /** The payment gateway fee setting; null while it has no value. */
  readonly paymentGatewayFeePercent: number | null;
  readonly rows: readonly ProfitReportRow[];
  readonly totals: ProfitTotals;
  readonly creditsSold: { readonly label: string; readonly rows: readonly CreditSalesView[] };
};
