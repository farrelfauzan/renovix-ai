import { z } from "zod";

const OFFSET_DATE_TIME = z.iso.datetime({ offset: true });

/** The date of an ISO 8601 date-time with an offset (or Z); null for anything else, so no zone is guessed (RNX-229). */
export const offsetDateOf = (value: string | null | undefined): Date | null =>
  OFFSET_DATE_TIME.safeParse(value).success ? new Date(value as string) : null;
