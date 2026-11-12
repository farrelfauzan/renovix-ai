import type { ConfigService } from "@nestjs/config";
import { S3Service } from "./s3.service";

// RNX-43 (AC4): S3_CDN_DOMAIN and S3_ENDPOINT are optional; without them the service starts and signed URLs are kept as they are.
const configOf = (values: Record<string, string>): ConfigService =>
  ({
    get: (name: string) => values[name],
    getOrThrow: (name: string) => {
      if (values[name] === undefined) throw new TypeError(`Configuration key "${name}" does not exist`);
      return values[name];
    },
  }) as unknown as ConfigService;

const baseValues = {
  S3_BUCKET: "test-bucket",
  S3_REGION: "ap-southeast-1",
  S3_ACCESS_KEY_ID: "test-access-key-not-real",
  S3_SECRET_ACCESS_KEY: "test-secret-key-not-real",
};

describe("S3Service without S3_CDN_DOMAIN and S3_ENDPOINT", () => {
  it("is constructed", () => {
    expect(() => new S3Service(configOf(baseValues))).not.toThrow();
  });

  it("keeps the signed URL when S3_CDN_DOMAIN is unset", async () => {
    const service = new S3Service(configOf(baseValues));
    await expect(service.getPresignedUrl("key", "file.txt")).resolves.toContain("test-bucket");
  });

  it("keeps the signed URL when S3_CDN_DOMAIN is empty", async () => {
    const service = new S3Service(configOf({ ...baseValues, S3_CDN_DOMAIN: "" }));
    await expect(service.getPresignedUrl("key", "file.txt")).resolves.toContain("test-bucket");
  });
});
