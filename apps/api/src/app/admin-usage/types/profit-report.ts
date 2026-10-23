import type { CreditSalesView } from "./credit-sales-view";
import type { ProfitReportRow } from "./profit-report-row";
import type { ProfitTotals } from "./profit-totals";
import type { ReportPeriod } from "./report-period";

/** GET /admin/usage/profit (RNX-228): cost, revenue, profit and net margin of the period, and the credits sold. */
export type ProfitReport = ReportPeriod & {
  readonly ppnRate: string;
  /** The paymentGatewayFeePercent setting; null while it has no value. */
  readonly paymentGatewayFeePercent: number | null;
  readonly rows: ProfitReportRow[];
  readonly totals: ProfitTotals;
  readonly creditsSold: { readonly label: string; readonly rows: CreditSalesView[] };
};
