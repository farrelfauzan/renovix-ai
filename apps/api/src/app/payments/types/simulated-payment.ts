/** A payment the fake provider pretends it received (RNX-35, tests): the amount (the charge's by default) and when. */
export type SimulatedPayment = {
  readonly amountRupiah?: number;
  readonly paidAt?: Date;
};
