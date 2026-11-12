/** RNX-42: the options of an SseStream. `heartbeatIntervalMs` defaults to SSE_HEARTBEAT_INTERVAL_MS; tests set a shorter one. */
export type SseStreamOptions = {
  readonly heartbeatIntervalMs?: number;
};
