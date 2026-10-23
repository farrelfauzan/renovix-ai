"use client";

import { useEffect, useState } from "react";
import type { AdminProfile } from "@/lib/session/admin-profile";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { defaultUsageApi } from "@/lib/usage/default-usage-api";
import { lastDaysRange } from "@/lib/usage/last-days-range";
import type { ReportRange } from "@/lib/usage/report-range";
import type { UsageApi } from "@/lib/usage/usage-api";
import { ProfitSection } from "./profit-section";
import { ReconciliationSection } from "./reconciliation-section";
import { ReportRangeForm } from "./report-range-form";
import { SectionMessage } from "./section-message";
import { UsageSection } from "./usage-section";

const DEFAULT_RANGE_DAYS = 30;

type UsageAndCostScreenProps = {
  /** Replaced in tests only. */
  readonly api?: UsageApi;
  readonly sessionApi?: SessionApi;
  readonly initialRange?: ReportRange;
};

/**
 * The usage and cost screen (RNX-163, PRD 09 F10): token usage, cost and profit, and the provider reconciliation of
 * one range. Each view shows only when the signed-in admin's permissions allow it (visibility only: the API
 * enforces them, and a refused read shows the API's message). Every figure is the API's aggregate.
 */
export function UsageAndCostScreen({ api = defaultUsageApi, sessionApi = defaultSessionApi, initialRange }: UsageAndCostScreenProps) {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<ReportRange>(() => initialRange ?? lastDaysRange(DEFAULT_RANGE_DAYS));
  useEffect(() => {
    sessionApi.me().then(setProfile, (err: unknown) => setLoadError(err instanceof Error ? err.message : "The session could not be read."));
  }, [sessionApi]);
  if (loadError) return <SectionMessage text={loadError} isError />;
  if (!profile) return <SectionMessage text="Loading…" />;
  const has = (permission: string): boolean => profile.permissions.includes(permission);
  const canSeeUsage = has("usage:read");
  const canSeeProfit = has("profit:read");
  const canWrite = has("reconciliation:write");
  if (!canSeeUsage && !canSeeProfit && !canWrite) return <SectionMessage text="Your role has no access to usage and cost." />;
  return (
    <div className="mt-4 flex flex-col gap-6">
      <ReportRangeForm initial={range} onApply={setRange} />
      {canSeeUsage && <UsageSection api={api} range={range} canReveal={has("users:read_pii")} />}
      {canSeeProfit && <ProfitSection api={api} range={range} />}
      {(canSeeProfit || canWrite) && (
        <ReconciliationSection api={api} range={range} canReadReport={canSeeProfit} canWrite={canWrite} canListProviders={has("providers:read")} />
      )}
    </div>
  );
}
