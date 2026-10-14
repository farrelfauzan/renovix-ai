/** A recovery code as stored and compared: lowercase, without dashes and spaces ("A1B2-c3d4" → "a1b2c3d4"). */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "");
}
