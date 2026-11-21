import type { Decimal } from "@prisma/client/runtime/client";
import type { CreditLedgerEntry } from "@generated/prisma/client.js";

/**
 * RNX-340: a call's last usage entry with `totalCharged`, what all of the call's usage entries took from its wallets
 * (fromHold + fromAvailable, never the uncharged part). A call on one wallet has one entry: `totalCharged` is its
 * `amount` negated.
 */
export type UsageEntry = CreditLedgerEntry & { readonly totalCharged: Decimal };
