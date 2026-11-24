/** RNX-331: POST /chat/portal/credit-estimate, the most credits the reservation of this message would hold. */
export type CreditEstimate = {
  /** The worst case in credits, a decimal string with six decimals (one micro-credit); null when the knowledgeSearchAllowanceCredits setting is not set (no figure). */
  readonly credits: string | null;
};
