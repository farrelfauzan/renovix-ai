/**
 * What a masked value shows (RX-164, PRD 09 §5). The whole value is replaced; no part of it (first
 * letter, domain, last digits) is kept, so nothing about the person can be read from the mask.
 */
const MASK = "***";
/** Keys whose value is personal whatever it looks like (compared lowercased, without "_" and "-"). */
const PERSONAL_KEYS = new Set(["email", "phone", "phonenumber"]);
/** An email address anywhere in a text. */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** A phone number anywhere in a text: starts with "+", "0" or "62" (Indonesia), then digits and separators. */
const PHONE = /(?:\+\d|\b0|\b62)\d[\d\s().-]{6,}\d/;
/** Fewest digits a phone number has. */
const MIN_PHONE_DIGITS = 8;

const isPersonalKey = (key: string): boolean => PERSONAL_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));

function holdsPersonalData(text: string): boolean {
  if (EMAIL.test(text)) return true;
  const phone = PHONE.exec(text);
  return phone !== null && phone[0].replace(/\D/g, "").length >= MIN_PHONE_DIGITS;
}

/**
 * Masks the personal data in an audit value for an admin without `users:read_pii` (RX-164): anywhere
 * inside it (nested objects and arrays), a text that holds an email address or a phone number becomes
 * "***", and so does the value of an `email`, `phone` or `phoneNumber` key, whatever it is. Errs on the
 * safe side: a number that only looks like a phone is masked too. Everything else is returned as is.
 */
export function maskPersonalData(value: unknown): unknown {
  if (typeof value === "string") return holdsPersonalData(value) ? MASK : value;
  if (Array.isArray(value)) return value.map(maskPersonalData);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isPersonalKey(key) ? MASK : maskPersonalData(item)]));
}
