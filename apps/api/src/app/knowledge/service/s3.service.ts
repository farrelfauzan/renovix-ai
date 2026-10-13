import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly cdnDomain: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow<string>("S3_BUCKET");
    this.cdnDomain = this.normalizeDomain(
      this.configService.getOrThrow<string>("S3_CDN_DOMAIN"),
    );

    const endpoint = this.configService.get<string>("S3_ENDPOINT") || undefined;
    const configuredRegion = this.configService.getOrThrow<string>("S3_REGION");
    const isGcsEndpoint = endpoint?.includes("storage.googleapis.com");
    const region = isGcsEndpoint ? "auto" : configuredRegion;

    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle: !!endpoint, // needed for MinIO / local S3
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>("S3_ACCESS_KEY_ID"),
        secretAccessKey: this.configService.getOrThrow<string>(
          "S3_SECRET_ACCESS_KEY",
        ),
      },
    });
  }

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    this.logger.log(`Uploaded ${key} to S3`);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    const stream = response.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    this.logger.log(`Deleted ${key} from S3`);
  }

  buildKey(userId: string, knowledgeBaseId: string, filename: string): string {
    return `knowledge/${userId}/${knowledgeBaseId}/${Date.now()}-${filename}`;
  }

  async uploadWithDisposition(
    key: string,
    body: Buffer,
    contentType: string,
    filename: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentDisposition: `attachment; filename="${filename}"`,
      }),
    );

    this.logger.log(`Uploaded ${key} to S3`);
    return key;
  }

  async getPresignedUrl(
    key: string,
    filename: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });
    const signedUrl = await getSignedUrl(this.client, command, { expiresIn });
    return this.toCdnUrl(signedUrl);
  }

  private toCdnUrl(url: string): string {
    if (!this.cdnDomain) {
      return url;
    }

    try {
      const parsed = new URL(url);
      parsed.host = this.cdnDomain;
      parsed.protocol = "https:";
      return parsed.toString();
    } catch {
      this.logger.warn("Failed to rewrite signed URL to CDN domain");
      return url;
    }
  }

  private normalizeDomain(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    try {
      return new URL(trimmed).host;
    } catch {
      return trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");
    }
  }
}
