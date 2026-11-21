/** RNX-334: an image type a profile photo may have, as decided from the file's bytes. */
export interface ProfilePhotoType {
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  readonly extension: "png" | "jpg" | "webp";
}
