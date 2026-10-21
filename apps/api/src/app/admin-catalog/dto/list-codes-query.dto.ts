import { z } from "zod";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** GET /admin/codes (RNX-226): the page (from 1) and its size. */
export const ListCodesQueryDto = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListCodesQueryDto = z.infer<typeof ListCodesQueryDto>;
