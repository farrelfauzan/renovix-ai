/**
 * RNX-326: how long before the route's socket timeout a run with agent calls stops (run option `socketTimeoutMs`), so
 * the stop's own work fits before the socket closes: the aborted call's usage entry, the child rows, the output
 * approval, the stored answer, the reservation's settle and the last SSE writes (database writes, well under a second
 * normally; ten times that leaves room for a slow database).
 */
export const PEER_RUN_SOCKET_MARGIN_MS = 10_000;
