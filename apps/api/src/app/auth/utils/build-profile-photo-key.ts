import { randomUUID } from "node:crypto";
import type { ProfilePhotoType } from "../types/profile-photo-type";
import { buildProfilePhotoKeyPrefix } from "./build-profile-photo-key-prefix";

/** RNX-334: a new storage key for this user's photo: the user's prefix, a random id and the type's extension. */
export function buildProfilePhotoKey(userId: string, extension: ProfilePhotoType["extension"], objectId: string = randomUUID()): string {
  return `${buildProfilePhotoKeyPrefix(userId)}${objectId}.${extension}`;
}
