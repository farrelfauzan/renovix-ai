/**
 * Decision 23: how many days a soft-deleted row is kept before it is purged, one setting for every model. RNX-126 shows
 * it as each deleted row's `purgeAt`; RNX-127's purge job uses the same value.
 */
export const SOFT_DELETE_RETENTION_DAYS = 30;
