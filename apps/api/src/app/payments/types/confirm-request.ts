/** An admin's "confirm from provider" (RNX-35): who, which order, why, and the request id for the audit row. */
export type ConfirmRequest = {
  readonly adminId: string;
  readonly orderId: string;
  readonly reason: string;
  readonly requestId: string;
};
