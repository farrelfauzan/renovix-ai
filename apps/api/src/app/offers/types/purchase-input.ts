/** A purchase to record: the buyer, the version bought, and the payment (null until checkout exists, RX-35). */
export type PurchaseInput = {
  readonly buyerUserId: string;
  readonly versionId: string;
  readonly paymentId: string | null;
};
