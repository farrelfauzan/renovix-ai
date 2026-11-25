const GROUP_LENGTH = 4;

/** `text` cut into groups of four characters (the last may be shorter), for reading a TOTP key by hand (RNX-333). */
export function groupInFours(text: string): string[] {
  return Array.from({ length: Math.ceil(text.length / GROUP_LENGTH) }, (_, index) => text.slice(index * GROUP_LENGTH, (index + 1) * GROUP_LENGTH));
}
