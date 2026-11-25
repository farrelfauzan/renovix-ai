const CODE_PREFIX = "DEVSEED-";
const USER_ID_PART_LENGTH = 12;

/** The fixed code text of this user's dev seed: "DEVSEED-" and the first 12 hex digits of the user id, upper case (20 characters). */
export function buildDevSeedCode(userId: string): string {
  return `${CODE_PREFIX}${userId.replaceAll("-", "").slice(0, USER_ID_PART_LENGTH).toUpperCase()}`;
}
