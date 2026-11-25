"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AdminProfile } from "@/lib/session/admin-profile";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { DEFAULT_RANGE_DAYS } from "@/lib/usage/default-range-days";
import { defaultUsageApi } from "@/lib/usage/default-usage-api";
import { lastDaysRange } from "@/lib/usage/last-days-range";
import type { ReportRange } from "@/lib/usage/report-range";
import type { UsageApi } from "@/lib/usage/usage-api";
import { ProfitSection } from "./profit-section";
import { ReconciliationSection } from "./reconciliation-section";
import { ReportRangePicker } from "./report-range-picker";
import { SectionMessage } from "./section-message";
import { UsageSection } from "./usage-section";

type UsageAndCostScreenProps = {
  /** The page heading, shown in the header row with the range picker. */
  readonly heading?: ReactNode;
  /** Replaced in tests only. */
  readonly api?: UsageApi;
  readonly sessionApi?: SessionApi;
  readonly initialRange?: ReportRange;
};

/**
 * The usage and cost screen (RNX-163, PRD 09 F10), in the design canvas's layout (RNX-315): the header with the range,
 * the profit totals as a KPI row with the daily cost and profit table, token usage, and the provider reconciliation of
 * one range. Each view shows only when the signed-in admin's permissions allow it (visibility only: the API enforces
 * them, and a refused read shows the API's message). Every figure is the API's aggregate.
 */
export function UsageAndCostScreen({ heading, api = defaultUsageApi, sessionApi = defaultSessionApi, initialRange }: UsageAndCostScreenProps) {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<ReportRange>(() => initialRange ?? lastDaysRange(DEFAULT_RANGE_DAYS));
  useEffect(() => {
    sessionApi.me().then(setProfile, (err: unknown) => setLoadError(err instanceof Error ? err.message : "The session could not be read."));
  }, [sessionApi]);
  const has = (permission: string): boolean => profile?.permissions.includes(permission) ?? false;
  const canSeeUsage = has("usage:read");
  const canSeeProfit = has("profit:read");
  const canWrite = has("reconciliation:write");
  const hasAccess = canSeeUsage || canSeeProfit || canWrite;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rx-line pb-3">
        {heading}
        {hasAccess && <ReportRangePicker range={range} isInitiallyCustom={initialRange !== undefined} onApply={setRange} />}
      </header>
      {loadError && <SectionMessage text={loadError} isError />}
      {!loadError && !profile && <SectionMessage text="Loading…" />}
      {profile && !hasAccess && <SectionMessage text="Your role has no access to usage and cost." />}
      {canSeeProfit && <ProfitSection api={api} range={range} />}
      {canSeeUsage && <UsageSection api={api} range={range} canReveal={has("users:read_pii")} />}
      {(canSeeProfit || canWrite) && (
        <ReconciliationSection api={api} range={range} canReadReport={canSeeProfit} canWrite={canWrite} canListProviders={has("providers:read")} />
      )}
    </div>
  );
}
