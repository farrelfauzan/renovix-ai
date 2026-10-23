/** How a FakePaymentProvider is built (RNX-35): its webhook signing key (none: no webhook verifies) and its amount limits. */
export type FakeProviderOptions = {
  readonly webhookSecret?: string;
  readonly minAmountRupiah?: number;
  readonly maxAmountRupiah?: number;
};
