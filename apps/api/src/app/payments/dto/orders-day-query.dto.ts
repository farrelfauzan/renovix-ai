import { z } from "zod";

/** A Jakarta calendar day, "YYYY-MM-DD". */
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((day) => !Number.isNaN(Date.parse(`${day}T00:00:00+07:00`)), "Not a calendar day");

/** GET /admin/payments/orders/export (RNX-35): the Jakarta day to export. */
export const OrdersDayQueryDto = z.strictObject({ day: DAY });
export type OrdersDayQueryDto = z.infer<typeof OrdersDayQueryDto>;
