import { z } from "zod";

/** Longest email address (RFC 5321 path limit). */
const MAX_EMAIL_LENGTH = 254;
/** Longest id accepted as a filter (user and package ids are UUIDs). */
const MAX_ID_LENGTH = 64;

/**
 * GET /admin/users (RNX-357). `email` and `id` are exact lookups, never a prefix or substring: the email is trimmed and
 * lowercased (sign-up stores emails lowercased), then compared for equality. `packageId` and `status` filter; `page`
 * starts at 1 (a page past the end is empty). Any other parameter is refused.
 */
export const ListUsersQueryDto = z.strictObject({
  email: z.string().trim().toLowerCase().min(1).max(MAX_EMAIL_LENGTH).optional(),
  id: z.string().trim().min(1).max(MAX_ID_LENGTH).optional(),
  packageId: z.string().trim().min(1).max(MAX_ID_LENGTH).optional(),
  status: z.enum(["active", "suspended", "locked"]).optional(),
  page: z.coerce.number().int().positive().default(1),
});
export type ListUsersQueryDto = z.infer<typeof ListUsersQueryDto>;
