import type { ProfilePhotoType } from "../types/profile-photo-type";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF_MARKER = "RIFF";
const WEBP_MARKER = "WEBP";
const WEBP_MARKER_OFFSET = 8;

const hasSignature = (bytes: Buffer, signature: readonly number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

/**
 * RNX-334: the image type of these bytes (PNG, JPEG or WebP), read from the file's own signature, never from its
 * declared type or name; null for anything else (a GIF, a PDF, a text file called `.png`).
 */
export function detectProfilePhotoType(bytes: Buffer): ProfilePhotoType | null {
  if (hasSignature(bytes, PNG_SIGNATURE)) return { mimeType: "image/png", extension: "png" };
  if (hasSignature(bytes, JPEG_SIGNATURE)) return { mimeType: "image/jpeg", extension: "jpg" };
  const isWebp =
    bytes.toString("latin1", 0, RIFF_MARKER.length) === RIFF_MARKER &&
    bytes.toString("latin1", WEBP_MARKER_OFFSET, WEBP_MARKER_OFFSET + WEBP_MARKER.length) === WEBP_MARKER;
  return isWebp ? { mimeType: "image/webp", extension: "webp" } : null;
}
