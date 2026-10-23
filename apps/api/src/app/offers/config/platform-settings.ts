import { z } from "zod";
import { CREDIT_AMOUNT } from "./credit-amount";

/** A count that may be 0. */
const COUNT = z.int32().nonnegative();
/** A count, a number of days or a duration that must be at least 1. */
const AT_LEAST_ONE = z.int32().positive();
/** A credit amount above 0. */
const POSITIVE_CREDITS = CREDIT_AMOUNT.positive();

/**
 * The registry of typed platform settings (RX-86, docs/credits.md section 9): each setting's name and the Zod
 * schema every write is validated against. The values live in the `platform_settings` table (seeded from
 * prisma/offers.seed.json), never here. A setting without a row is not set.
 */
export const PLATFORM_SETTINGS = {
  /** Free weekly allowance in credits (D5). */
  weeklyFreeAllowanceCredits: CREDIT_AMOUNT,
  /** Demo agent runs per account per week (D43). */
  demoRunsPerAccountPerWeek: COUNT,
  /** Demo agent runs per IP per day (D43). */
  demoRunsPerIpPerDay: COUNT,
  /** Credits a started demo run may go over the weekly wallet (D43, RX-22). */
  demoOverageCapCredits: CREDIT_AMOUNT,
  /** Amber banner when the projected run-out is within this many days (D47). */
  runOutAmberDays: AT_LEAST_ONE,
  /** Red banner when the projected run-out is within this many days (D47). */
  runOutRedDays: AT_LEAST_ONE,
  /** Always warn below this available balance, in credits (D47). */
  runOutFloorCredits: POSITIVE_CREDITS,
  /** Peer-agent runs: maximum call depth (D77 Q5). */
  peerRunMaxDepth: AT_LEAST_ONE,
  /** Peer-agent runs: agent calls per run (D77 Q5). */
  peerRunMaxAgentCalls: AT_LEAST_ONE,
  /** Peer-agent runs: model calls per run (D77 Q5). */
  peerRunMaxModelCalls: AT_LEAST_ONE,
  /** Peer-agent runs: seconds per model call (D77 Q5). */
  peerRunCallTimeoutSeconds: AT_LEAST_ONE,
  /** Peer-agent runs: minutes per run (D77 Q5). */
  peerRunMaxMinutes: AT_LEAST_ONE,
  /** Per-run credit cap (docs/credits.md section 13.2). */
  perRunCreditCap: POSITIVE_CREDITS,
  /** The lowest per-run cap a workspace owner may set, in credits (section 13.2). */
  perRunCreditCapFloor: POSITIVE_CREDITS,
  /** Seats per company across its workspaces; a contract's seat limit may not exceed it (D7). */
  seatCeiling: AT_LEAST_ONE,
  /** Projection: below this spend in the last 7 days, in credits, show "not enough use yet" (RX-30). */
  projectionMinSpendCredits: CREDIT_AMOUNT,
  /** Projection: a run-out further away than this many days shows "more than a year" (RX-30). */
  projectionMaxDays: AT_LEAST_ONE,
  /** Anonymous free-tier chat requests per IP per Jakarta day (RNX-226). No value; the portal still reads ANON_DAILY_IP_CAP. */
  anonymousRequestsPerIpPerDay: AT_LEAST_ONE,
  /** Anonymous free-tier chat requests across all IPs per Jakarta day (RNX-226). No value; the portal still reads ANON_DAILY_GLOBAL_CAP. */
  anonymousRequestsGlobalPerDay: AT_LEAST_ONE,
  /** Enterprise grace period before freezing, in days, may be 0; the contract field has the same name (D27, open: no value). */
  graceDays: COUNT,
  /** High-severity guardrail violations within a fixed 7-day window that make a repeat offender (D59, PRD 09 F9; no value). */
  repeatOffenderThreshold: AT_LEAST_ONE,
  // RNX-228: the profit report and the provider reconciliation. No values (D46, D250): until set, the net margin and the
  // reconciliation flag are not computed.
  /** The payment gateway's fee, as a percentage (0 to 100) of the gross amount charged; the net margin deducts it (RNX-228). */
  paymentGatewayFeePercent: z.number().min(0).max(100),
  /** A provider's day is flagged when its portal drop is above our high estimate by more than this percentage of it (RNX-228). */
  reconciliationDriftThresholdPercent: z.number().nonnegative().max(1000),
} as const;
