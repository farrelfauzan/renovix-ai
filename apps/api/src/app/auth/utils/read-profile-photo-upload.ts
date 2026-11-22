import { PROFILE_PHOTO_MAX_BYTES } from "../config/profile-photo-max-bytes";
import type { ProfilePhotoUploadRequest } from "../types/profile-photo-upload-request";
import { createProfilePhotoException } from "./create-profile-photo-exception";

const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * RNX-334: the bytes of the request's multipart file, read with the photo limit as the per-request multipart limit:
 * reading stops at the limit, so an oversized upload is never buffered whole. A file of exactly the limit is
 * accepted; one byte more (the stream is truncated) is a 400 that names the limit. The form's other fields are ignored.
 */
export async function readProfilePhotoUpload(req: ProfilePhotoUploadRequest): Promise<Buffer> {
  const file = await req.file({ limits: { fileSize: PROFILE_PHOTO_MAX_BYTES }, throwFileSizeLimit: false });
  if (!file) throw createProfilePhotoException("Choose a photo to upload.");
  const bytes = await file.toBuffer();
  if (file.file.truncated) {
    throw createProfilePhotoException(`The photo is larger than the ${PROFILE_PHOTO_MAX_BYTES / BYTES_PER_MEGABYTE} MB limit.`);
  }
  return bytes;
}
