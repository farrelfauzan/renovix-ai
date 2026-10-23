"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderOption } from "@/lib/usage/provider-option";
import type { ReportRange } from "@/lib/usage/report-range";
import type { UsageApi } from "@/lib/usage/usage-api";
import { useReport } from "@/lib/usage/use-report";
import { ReconciliationEntryForm } from "./reconciliation-entry-form";
import { ReconciliationTable } from "./reconciliation-table";
import { SectionMessage } from "./section-message";

type ReconciliationSectionProps = {
  readonly api: UsageApi;
  readonly range: ReportRange;
  /** The days table needs `profit:read`; the form needs `reconciliation:write`; the providers list `providers:read`. */
  readonly canReadReport: boolean;
  readonly canWrite: boolean;
  readonly canListProviders: boolean;
};

const NO_REPORT = () => Promise.resolve(null);

/** The provider reconciliation: the portal balance form and the flagged days per provider (visibility follows the permissions). */
export function ReconciliationSection({ api, range, canReadReport, canWrite, canListProviders }: ReconciliationSectionProps) {
  const { data, error, reload } = useReport(useCallback(() => (canReadReport ? api.reconciliation(range) : NO_REPORT()), [api, range, canReadReport]));
  const [providers, setProviders] = useState<readonly ProviderOption[] | null>(null);
  useEffect(() => {
    if (canListProviders) api.listProviders().then(setProviders, () => setProviders(null));
  }, [api, canListProviders]);
  const providerNames = useMemo(() => new Map((providers ?? []).map(({ id, name }) => [id, name])), [providers]);
  return (
    <section aria-labelledby="reconciliation-heading" className="flex flex-col gap-3">
      <h2 id="reconciliation-heading" className="text-lg font-semibold">Provider reconciliation</h2>
      {canWrite && <ReconciliationEntryForm api={api} providers={providers} onRecorded={reload} />}
      {error && <SectionMessage text={`The reconciliation could not be loaded: ${error}`} isError />}
      {data && (
        <>
          <p className="text-xs text-rx-muted">
            Drift threshold: {data.driftThresholdPercent === null ? "not set (nothing is flagged)" : `${data.driftThresholdPercent}%`}
          </p>
          {data.rows.length === 0 ? <SectionMessage text="No portal balance entered in this range." /> : <ReconciliationTable rows={data.rows} providerNames={providerNames} />}
        </>
      )}
    </section>
  );
}
