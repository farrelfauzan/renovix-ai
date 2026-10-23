import type { SettingDescription } from "./setting-description";

const credits = (label: string, min = 0): SettingDescription => ({ label, unit: "credits", min });
const count = (label: string, min = 1, isNotAppliedYet = false): SettingDescription => ({ label, unit: "count", min, isNotAppliedYet });
const percent = (label: string): SettingDescription => ({ label, unit: "percent", min: 0 });

/** The registry of apps/api (offers/config/platform-settings.ts) by name: label, unit and lowest value. */
export const SETTING_DESCRIPTIONS: Readonly<Record<string, SettingDescription>> = {
  weeklyFreeAllowanceCredits: credits("Free weekly allowance, credits (D5)"),
  demoRunsPerAccountPerWeek: count("Demo runs per account per week (D43)", 0),
  demoRunsPerIpPerDay: count("Demo runs per IP per day (D43)", 0),
  demoOverageCapCredits: credits("Demo overage cap, credits (D43)"),
  runOutAmberDays: count("Run-out amber banner, days left (D45)"),
  runOutRedDays: count("Run-out red banner, days left (D45)"),
  runOutFloorCredits: credits("Run-out floor, credits (D45)", 0.000001),
  peerRunMaxDepth: count("Peer runs: maximum call depth"),
  peerRunMaxAgentCalls: count("Peer runs: agent calls per run"),
  peerRunMaxModelCalls: count("Peer runs: model calls per run"),
  peerRunCallTimeoutSeconds: count("Peer runs: seconds per model call"),
  peerRunMaxMinutes: count("Peer runs: minutes per run"),
  perRunCreditCap: credits("Per-run credit cap", 0.000001),
  perRunCreditCapFloor: credits("Lowest per-run cap a workspace owner may set", 0.000001),
  seatCeiling: count("Seat ceiling per company (D7)"),
  projectionMinSpendCredits: credits("Projection: minimum spend in 7 days, credits"),
  projectionMaxDays: count("Projection: longest run-out shown, days"),
  anonymousRequestsPerIpPerDay: count("Anonymous requests per IP per day", 1, true),
  anonymousRequestsGlobalPerDay: count("Anonymous requests in total per day", 1, true),
  graceDays: count("Enterprise grace period, days (D27)", 0, true),
  repeatOffenderThreshold: count("Repeat-offender threshold, violations in 7 days (D59)", 1, true),
  paymentGatewayFeePercent: percent("Payment gateway fee, % of gross (RNX-228)"),
  reconciliationDriftThresholdPercent: percent("Reconciliation drift threshold, % of the high estimate (D84, RNX-228)"),
};
