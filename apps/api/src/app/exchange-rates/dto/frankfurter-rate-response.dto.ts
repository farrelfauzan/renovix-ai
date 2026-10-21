import { z } from "zod";

/** Frankfurter's v2 single-pair answer (RNX-53): a USD to IDR pair, the rate's own date and a positive rate. */
export const FrankfurterRateResponseDto = z.object({
  base: z.literal("USD"),
  quote: z.literal("IDR"),
  date: z.iso.date(),
  rate: z.number().positive(),
});
export type FrankfurterRateResponseDto = z.infer<typeof FrankfurterRateResponseDto>;
