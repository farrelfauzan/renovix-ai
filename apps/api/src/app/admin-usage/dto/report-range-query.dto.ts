import { z } from "zod";
import { MAX_REPORT_DAYS } from "../config/max-report-days";
import { listDays } from "../utils/list-days";

/**
 * The period of a usage, profit or reconciliation read (RNX-228): `from` and `to` as calendar days (YYYY-MM-DD,
 * Asia/Jakarta), both included, `to` not before `from`, at most MAX_REPORT_DAYS days.
 */
export const ReportRangeQueryDto = z
  .strictObject({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => to >= from, { message: "to must not be before from", path: ["to"] })
  .refine(({ from, to }) => listDays(from, to).length <= MAX_REPORT_DAYS, { message: `at most ${MAX_REPORT_DAYS} days`, path: ["to"] });
export type ReportRangeQueryDto = z.infer<typeof ReportRangeQueryDto>;
