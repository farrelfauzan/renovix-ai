import { z } from "zod";

/** When a new version takes effect (RNX-226): an ISO 8601 date-time with its offset, e.g. "2026-11-01T00:00:00+07:00". */
export const EffectiveFromDto = z.iso.datetime({ offset: true });
export type EffectiveFromDto = z.infer<typeof EffectiveFromDto>;
