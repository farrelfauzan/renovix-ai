import { z } from "zod";
import { AUTOGOPAY_LOCAL_UTC_OFFSET_MS } from "../config/autogopay-local-utc-offset";

const OFFSET_DATE_TIME = z.iso.datetime({ offset: true });
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const UTC_DATE_TIME = z.iso.datetime();

/**
 * The date of an AutoGoPay date-time (RNX-273): `YYYY-MM-DD HH:mm:ss` read at AUTOGOPAY_LOCAL_UTC_OFFSET_MS (WIB,
 * D285), or an ISO 8601 date-time with an offset (or Z); null for anything else (an impossible date included).
 */
export function parseAutoGoPayDate(value: string | null | undefined): Date | null {
  if (OFFSET_DATE_TIME.safeParse(value).success) return new Date(value as string);
  if (value == null || !LOCAL_DATE_TIME.test(value)) return null;
  const asUtc = `${value.replace(" ", "T")}Z`;
  return UTC_DATE_TIME.safeParse(asUtc).success ? new Date(Date.parse(asUtc) - AUTOGOPAY_LOCAL_UTC_OFFSET_MS) : null;
}
