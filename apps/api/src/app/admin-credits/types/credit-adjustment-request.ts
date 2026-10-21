import type { CreditAdjustmentDto } from "../dto/credit-adjustment.dto";

/** One credit adjustment to make (RNX-227): who makes it, the back-office action id, and the parsed body. */
export type CreditAdjustmentRequest = {
  readonly adminId: string;
  /** The request id, which the audit row records: the new entry's reference. */
  readonly actionId: string;
  readonly adjustment: CreditAdjustmentDto;
};
