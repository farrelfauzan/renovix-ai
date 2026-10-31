/** A package granted by an invitation code to record (RNX-251): the account that redeemed it and the code's version. */
export type CodeGrantInput = {
  readonly buyerUserId: string;
  readonly packageVersionId: string;
};
