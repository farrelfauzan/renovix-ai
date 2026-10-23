import type { PaymentOrderStatus } from "@generated/prisma/client.js";

/** One audited change of an order (RNX-35): the event and the status before and after. */
export type OrderChangeInput = {
  readonly orderId: string;
  readonly event: string;
  readonly fromStatus: PaymentOrderStatus | null;
  readonly toStatus: PaymentOrderStatus;
};
