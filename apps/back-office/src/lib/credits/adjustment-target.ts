/** The wallet an adjustment moves: one user's or one company's paid wallet (RNX-227). */
export type AdjustmentTarget = { readonly userId: string } | { readonly companyId: string };
