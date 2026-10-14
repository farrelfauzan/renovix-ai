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
      /**
       * Which back-office sessions a `staff` route accepts: by default only full sessions;
       * "enrolment" only sessions that have not enrolled TOTP yet; "any" both (RX-94).
       */
      readonly staffScope?: "enrolment" | "any";
      /** A sensitive back-office write: the caller re-authenticated within the configured window (`staff` routes only). */
      readonly reauth?: boolean;
      /** The named signature check of a webhook. */
      readonly webhook?: string;
    };
