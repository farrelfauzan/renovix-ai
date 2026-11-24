/**
 * RNX-351: the channel chat's own run time limit, in milliseconds from the run's start: a channel run with agent calls
 * stops at the smaller of this and `peerRunMaxMinutes`. Not the route's 180 s socket timeout (D383: that is an idle
 * timeout the SSE heartbeat resets, so it does not bound a run). 5 minutes: the seeded `peerRunMaxMinutes`, so the
 * setting rules by default, and under the credit reservation's 10-minute expiry, so a raised setting cannot keep a
 * channel run going after its hold has expired.
 */
export const CHANNEL_RUN_TIME_LIMIT_MS = 5 * 60_000;
