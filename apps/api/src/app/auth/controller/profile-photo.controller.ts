import { Controller, Delete, Get, HttpCode, Put, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import { ProfilePhotoService } from "../service/profile-photo.service";
import type { ProfilePhotoUploadRequest } from "../types/profile-photo-upload-request";
import type { ProfilePhotoUrl } from "../types/profile-photo-url";
import type { SignedInUserRequest } from "../types/signed-in-user-request";
import { readProfilePhotoUpload } from "../utils/read-profile-photo-upload";

/**
 * RNX-334: the signed-in user's own profile photo (Settings > General). Session only; the user comes from the session
 * and no path, query or body value names another one.
 */
@Controller("auth/me/photo")
export class ProfilePhotoController {
  constructor(private readonly profilePhotos: ProfilePhotoService) {}

  @Get()
  @Access({ auth: ["session"] })
  async getPhoto(@Req() req: SignedInUserRequest): Promise<ProfilePhotoUrl> {
    return this.profilePhotos.getPhotoUrl(req.user.userId);
  }

  /** Uploads or replaces the photo: a multipart file, PNG, JPEG or WebP, at most PROFILE_PHOTO_MAX_BYTES. */
  @Put()
  @Access({ auth: ["session"] })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async uploadPhoto(@Req() req: ProfilePhotoUploadRequest): Promise<ProfilePhotoUrl> {
    const bytes = await readProfilePhotoUpload(req);
    return this.profilePhotos.replacePhoto(req.user.userId, bytes);
  }

  @Delete()
  @HttpCode(204)
  @Access({ auth: ["session"] })
  async removePhoto(@Req() req: SignedInUserRequest): Promise<void> {
    await this.profilePhotos.removePhoto(req.user.userId);
  }
}
