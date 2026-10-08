import { Injectable, Logger } from "@nestjs/common";
import { Storage } from "@google-cloud/storage";
import * as path from "path";
import * as crypto from "crypto";

@Injectable()
export class GoogleStorageService {
  private readonly logger = new Logger(GoogleStorageService.name);
  private readonly storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  });

  private readonly bucket = this.storage.bucket(
    process.env.GOOGLE_CLOUD_BUCKET_NAME || "",
  );

  async generateUploadUrl(
    originalFileName: string,
    contentType: string,
    userId: string,
  ): Promise<{ uploadUrl: string; objectName: string }> {
    const ext = path.extname(originalFileName);

    const objectName = `users/${userId}/${crypto.randomUUID()}${ext}`;

    const file = this.bucket.file(objectName);

    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType,
    });

    this.logger.log(`Generated upload URL for ${objectName}`);

    return {
      uploadUrl: url,
      objectName,
    };
  }

  async generateDownloadUrl(objectName: string): Promise<string> {
    const file = this.bucket.file(objectName);

    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
    });

    this.logger.log(`Generated download URL for ${objectName}`);

    return url;
  }

  async deleteFile(objectName: string): Promise<void> {
    const file = this.bucket.file(objectName);
    await file.delete();

    this.logger.log(`Deleted file ${objectName}`);
  }
}
