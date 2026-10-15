import { z } from "zod";

/** The smallest ledger amount: 0.000001 credit (docs/credits.md section 2.3). */
const MICRO_CREDIT = 0.000001;
/** Above the largest value a Decimal(18, 6) column holds. */
const CREDIT_COLUMN_LIMIT = 1_000_000_000_000;

/** A credit amount: not negative, whole micro-credits, fits the Decimal(18, 6) columns. */
export const CREDIT_AMOUNT = z.number().nonnegative().multipleOf(MICRO_CREDIT).lt(CREDIT_COLUMN_LIMIT);
