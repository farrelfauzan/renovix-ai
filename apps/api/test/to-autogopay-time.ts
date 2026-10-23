// Written out here, not imported from the adapter's config, so a planted change there shows in the tests (RNX-273).
const WIB_OFFSET_MS = 7 * 60 * 60_000;

/** A date as AutoGoPay writes it (RNX-273, the official docs): `YYYY-MM-DD HH:mm:ss` in WIB (UTC+7), no offset. */
export const toAutoGoPayTime = (at: Date): string => new Date(at.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
