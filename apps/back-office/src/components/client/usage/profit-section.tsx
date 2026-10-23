"use client";

import { useCallback } from "react";
import type { ReportRange } from "@/lib/usage/report-range";
import type { UsageApi } from "@/lib/usage/usage-api";
import { useReport } from "@/lib/usage/use-report";
import { CreditsSoldTable } from "./credits-sold-table";
import { ProfitTable } from "./profit-table";
import { ProfitTotalsPanel } from "./profit-totals-panel";
import { SectionMessage } from "./section-message";

/** Cost, revenue, profit and margin of the range (`profit:read`): the API's totals, rows and credits sold. */
export function ProfitSection({ api, range }: { api: UsageApi; range: ReportRange }) {
  const { data, error } = useReport(useCallback(() => api.profit(range), [api, range]));
  return (
    <section aria-labelledby="profit-heading" className="flex flex-col gap-3">
      <h2 id="profit-heading" className="text-lg font-semibold">Cost and profit</h2>
      {error && <SectionMessage text={`Cost and profit could not be loaded: ${error}`} isError />}
      {!data && !error && <SectionMessage text="Loading cost and profit…" />}
      {data && (
        <>
          <ProfitTotalsPanel report={data} />
          {data.rows.length === 0 ? <SectionMessage text="No cost in this range." /> : <ProfitTable rows={data.rows} />}
          <CreditsSoldTable creditsSold={data.creditsSold} />
        </>
      )}
    </section>
  );
}
