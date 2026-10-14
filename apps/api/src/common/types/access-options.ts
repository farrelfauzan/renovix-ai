import { AccessMethod } from "./access-method";

/**
 * What `@Access` declares for a route or a controller: either public with the
 * reason, or the accepted sign-in methods and what the caller needs on top.
 */
export type AccessOptions =
  | { readonly public: true; readonly reason: string }
  | {
      readonly public?: never;
      /** Accepted sign-in methods, tried in this order. */
      readonly auth?: readonly AccessMethod[];
      /** Permission names the caller needs (none by default). */
      readonly permissions?: readonly string[];
      /** Plan the caller needs, for example Enterprise only. */
      readonly plan?: string;
      /** A sensitive back-office write: the caller signs in again. */
      readonly reauth?: boolean;
      /** The named signature check of a webhook. */
      readonly webhook?: string;
    };
