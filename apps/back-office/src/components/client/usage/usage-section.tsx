"use client";

import { useCallback } from "react";
import type { ReportRange } from "@/lib/usage/report-range";
import type { UsageApi } from "@/lib/usage/usage-api";
import { useReport } from "@/lib/usage/use-report";
import { SectionMessage } from "./section-message";
import { TablePager } from "./table-pager";
import { UsageTable } from "./usage-table";

type UsageSectionProps = { readonly api: UsageApi; readonly range: ReportRange; readonly canReveal: boolean };

/** Token usage of the range (`usage:read`): tokens by kind and calls per day, provider, model, tier and workspace or user. */
export function UsageSection({ api, range, canReveal }: UsageSectionProps) {
  const { data, error } = useReport(useCallback(() => api.usage(range), [api, range]));
  return (
    <section aria-labelledby="usage-heading" className="flex flex-col gap-3">
      <h2 id="usage-heading" className="text-lg font-semibold">Token usage</h2>
      {error && <SectionMessage text={`Token usage could not be loaded: ${error}`} isError />}
      {!data && !error && <SectionMessage text="Loading token usage…" />}
      {data && data.rows.length === 0 && <SectionMessage text="No usage in this range." />}
      {data && data.rows.length > 0 && (
        <TablePager rows={data.rows}>{(rows) => <UsageTable rows={rows} api={api} canReveal={canReveal} />}</TablePager>
      )}
    </section>
  );
}
