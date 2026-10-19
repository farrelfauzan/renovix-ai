/** Who owns a credit account (docs/credits.md Terms): one user, or one company (its pool). Exactly one is set. */
export type CreditAccountOwner =
  | { readonly userId: string; readonly companyId?: undefined }
  | { readonly companyId: string; readonly userId?: undefined };
