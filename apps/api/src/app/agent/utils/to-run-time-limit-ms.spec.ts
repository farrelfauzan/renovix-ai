import { PEER_RUN_SOCKET_MARGIN_MS } from "../config/peer-run-socket-margin-ms";
import { toRunTimeLimitMs } from "./to-run-time-limit-ms";

// RNX-326: the run time limit of a run with agent calls: peerRunMaxMinutes, cut at the route's socket timeout minus the margin.
describe("toRunTimeLimitMs", () => {
  it.each([
    ["no socket timeout: peerRunMaxMinutes", { maxRunMs: 120_000 }, 120_000],
    ["a socket timeout whose margin leaves less: the socket timeout minus the margin", { maxRunMs: 120_000, socketTimeoutMs: PEER_RUN_SOCKET_MARGIN_MS + 45_000 }, 45_000],
    ["a socket timeout whose margin leaves more: peerRunMaxMinutes", { maxRunMs: 120_000, socketTimeoutMs: PEER_RUN_SOCKET_MARGIN_MS + 180_000 }, 120_000],
    ["a peerRunMaxMinutes longer than a timer can wait: the longest timer delay, not an immediate stop", { maxRunMs: 40_000 * 60_000 }, 2 ** 31 - 1],
  ])("%s", (_case, input, expected) => {
    const actual = toRunTimeLimitMs(input);

    expect(actual).toBe(expected);
  });
});
