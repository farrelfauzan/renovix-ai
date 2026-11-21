import { Injectable, Logger } from "@nestjs/common";
import { S3Service } from "../../knowledge/service/s3.service";
import { UserRepository } from "../repository/user.repository";
import { PROFILE_PHOTO_URL_EXPIRY_SECONDS } from "../config/profile-photo-url-expiry-seconds";
import type { ProfilePhotoUrl } from "../types/profile-photo-url";
import { buildProfilePhotoKey } from "../utils/build-profile-photo-key";
import { createProfilePhotoException } from "../utils/create-profile-photo-exception";
import { detectProfilePhotoType } from "../utils/detect-profile-photo-type";
import { isExternalPhotoUrl } from "../utils/is-external-photo-url";
import { isProfilePhotoKey } from "../utils/is-profile-photo-key";

/** The download name of a presigned photo URL (the object's key is not shown to the person). */
const PHOTO_DOWNLOAD_NAME = "profile-photo";

/**
 * RNX-334: the signed-in user's own profile photo. `users.avatar` holds either an external https URL (a social
 * sign-up) or the storage key of an uploaded photo in the private bucket; every method takes the user from the
 * session and touches that user's row and objects only.
 */
@Injectable()
export class ProfilePhotoService {
  private readonly logger = new Logger(ProfilePhotoService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly storage: S3Service,
  ) {}

  /** Where this user's photo can be loaded from: a short-lived presigned URL, the external URL, or null for none. */
  async getPhotoUrl(userId: string): Promise<ProfilePhotoUrl> {
    const { avatar } = await this.users.findAvatarOrThrow(userId);
    if (isProfilePhotoKey(userId, avatar)) {
      return { url: await this.storage.getPresignedUrl(avatar, PHOTO_DOWNLOAD_NAME, PROFILE_PHOTO_URL_EXPIRY_SECONDS) };
    }
    return { url: isExternalPhotoUrl(avatar) ? avatar : null };
  }

  /**
   * Stores these bytes as the user's photo when they are a PNG, JPEG or WebP (decided from the bytes; a 400
   * otherwise, nothing stored), points `avatar` at the new object, then deletes the previous object if it was one.
   */
  async replacePhoto(userId: string, bytes: Buffer): Promise<ProfilePhotoUrl> {
    const type = detectProfilePhotoType(bytes);
    if (!type) throw createProfilePhotoException("The photo must be a PNG, JPEG or WebP image.");
    const { avatar: previous } = await this.users.findAvatarOrThrow(userId);
    const key = buildProfilePhotoKey(userId, type.extension);
    await this.storage.upload(key, bytes, type.mimeType);
    await this.users.setAvatar(userId, key);
    await this.deleteObjectQuietly(userId, previous);
    return this.getPhotoUrl(userId);
  }

  /** Clears the user's `avatar` (an external URL too), then deletes the object if it was an uploaded photo. */
  async removePhoto(userId: string): Promise<void> {
    const { avatar } = await this.users.findAvatarOrThrow(userId);
    await this.users.setAvatar(userId, null);
    await this.deleteObjectQuietly(userId, avatar);
  }

  /** Deletes the object when `avatar` is this user's uploaded photo; a failed delete only leaves an unused object. */
  private async deleteObjectQuietly(userId: string, avatar: string | null): Promise<void> {
    if (!isProfilePhotoKey(userId, avatar)) return;
    try {
      await this.storage.delete(avatar);
    } catch (err) {
      this.logger.warn(`Could not delete the old profile photo object ${avatar}: ${(err as Error).message}`);
    }
  }
}
