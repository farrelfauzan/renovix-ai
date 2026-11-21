import type { MultipartFile } from "@fastify/multipart";
import type { SignedInUserRequest } from "./signed-in-user-request";

/** RNX-334: a signed-in request that can also read its multipart file (`req.file()` of @fastify/multipart). */
export interface ProfilePhotoUploadRequest extends SignedInUserRequest {
  file(options: {
    readonly limits: { readonly fileSize: number };
    readonly throwFileSizeLimit: boolean;
  }): Promise<MultipartFile | undefined>;
}
