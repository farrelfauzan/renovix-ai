/**
 * The public source of the USD to IDR rate (RNX-53, D235): Frankfurter's v2 single-pair endpoint, pinned to the
 * European Central Bank's reference rate (`providers=ecb`; unpinned, v2 may answer from another provider). The ECB
 * publishes once a working day, around 16:00 CET. No API key. It answers
 * `{"date":"YYYY-MM-DD","base":"USD","quote":"IDR","rate":<number>}`.
 */
export const FRANKFURTER_SOURCE = {
  name: "frankfurter",
  url: "https://api.frankfurter.dev/v2/rate/USD/IDR?providers=ecb",
  base: "USD",
  quote: "IDR",
  timeoutMs: 10_000,
} as const;
