import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ConfigModule } from "@nestjs/config";
import { KnowledgeModule } from "./knowledge.module";
import { EmbeddingService } from "./embedding.service";
import { SystemKnowledgeService } from "./system-knowledge.service";
import { PrismaService } from "../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";

// RX-67: POST /v1/admin/system-kb/sync is removed; the startup and hourly
// syncs stay. The real KnowledgeModule runs on the test database. Nothing
// external runs: the system KB's S3 client lists an empty bucket, and the
// embedding and S3 services are stubs.
const mockS3Send = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockS3Send;
  },
  ListObjectsV2Command: class {
    constructor(readonly input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
}));
jest.mock("./embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("./s3.service", () => ({ S3Service: class {} }));

const ROUTE = "/v1/admin/system-kb/sync";

describe("RX-67: POST /v1/admin/system-kb/sync is removed (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let service: SystemKnowledgeService;
  let sync: jest.SpyInstance;
  const embedding = { embed: jest.fn(), embedSingle: jest.fn() };

  beforeAll(async () => {
    mockS3Send.mockResolvedValue({ Contents: [] });
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                S3_BUCKET: "test-bucket",
                S3_REGION: "test-region",
                S3_ACCESS_KEY_ID: "test",
                S3_SECRET_ACCESS_KEY: "test",
              }),
            ],
          }),
          KnowledgeModule,
        ],
      },
      (b) => b.overrideProvider(EmbeddingService).useValue(embedding),
    ));
    service = moduleRef.get(SystemKnowledgeService);
    // Spy before init, so the startup sync (onApplicationBootstrap) is recorded.
    sync = jest.spyOn(service, "sync");
    app = await createFastifyApp(moduleRef);
  });

  afterAll(() => app?.close());

  it("AC3: the startup sync ran when the app started", () => {
    expect(sync).toHaveBeenCalledTimes(1);
    expect(mockS3Send).toHaveBeenCalled();
  });

  describe("after start-up", () => {
    beforeEach(async () => {
      await resetDatabase(prisma);
      sync.mockClear();
      mockS3Send.mockClear();
      mockS3Send.mockResolvedValue({ Contents: [] });
      embedding.embed.mockClear();
    });

    it("AC1: without a session or API key the route is 401 or 404", async () => {
      const res = await app.inject({ method: "POST", url: ROUTE });

      expect([401, 404]).toContain(res.statusCode);
      expect(sync).not.toHaveBeenCalled();
    });

    it("AC2: a normal user's sk_live_ key gets 403 or 404 and sync never runs", async () => {
      await createUser(prisma, { apiKey: "sk_live_normal-user" });

      const res = await app.inject({
        method: "POST",
        url: ROUTE,
        headers: { authorization: "Bearer sk_live_normal-user" },
      });

      expect([403, 404]).toContain(res.statusCode);
      expect(sync).not.toHaveBeenCalled();
      expect(mockS3Send).not.toHaveBeenCalled();
      expect(await prisma.knowledgeBase.count({ where: { isSystem: true } })).toBe(0);
    });

    it("AC3: the hourly cron handler, called directly, runs sync", async () => {
      await service.handleCron();

      expect(sync).toHaveBeenCalledTimes(1);
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      expect(embedding.embed).not.toHaveBeenCalled();
      expect(await prisma.knowledgeBase.count({ where: { isSystem: true } })).toBe(1);
    });
  });
});
