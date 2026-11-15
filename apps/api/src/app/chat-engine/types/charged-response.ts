import type { Decimal } from "@prisma/client/runtime/client";
import type { MeteredResponse } from "../../agent/types/metered-response";

/** RNX-25 (D341 D5): a metered call's response with the credits its usage entry charged (0 for nothing charged). */
export type ChargedResponse = MeteredResponse & {
  readonly charge: Decimal;
};
