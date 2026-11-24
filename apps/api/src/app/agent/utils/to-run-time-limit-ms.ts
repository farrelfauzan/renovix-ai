import { PEER_RUN_SOCKET_MARGIN_MS } from "../config/peer-run-socket-margin-ms";

/** The longest delay a Node timer takes (a 32-bit signed integer); a longer one would fire at once. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * RNX-326: the run time limit of a run with agent calls, in milliseconds from the run's start: `peerRunMaxMinutes`
 * (`maxRunMs`), or the route's socket timeout minus PEER_RUN_SOCKET_MARGIN_MS when the route sets one and that is
 * smaller. RNX-351: never more than the run's own time limit (`runTimeLimitMs`, the channel chat's), when it has one,
 * with no margin. Never more than a timer can wait (about 24.8 days), so a very large setting cannot stop a run at once.
 */
export function toRunTimeLimitMs({ maxRunMs, runTimeLimitMs = maxRunMs, socketTimeoutMs }: { readonly maxRunMs: number; readonly runTimeLimitMs?: number; readonly socketTimeoutMs?: number }): number {
  const runMs = Math.min(maxRunMs, runTimeLimitMs);
  const limitMs = socketTimeoutMs === undefined ? runMs : Math.min(runMs, socketTimeoutMs - PEER_RUN_SOCKET_MARGIN_MS);
  return Math.min(limitMs, MAX_TIMER_DELAY_MS);
}
