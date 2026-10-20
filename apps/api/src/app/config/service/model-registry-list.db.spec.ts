import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../model-registry.service";
import { ModelsController } from "../../chat/controller/models.controller";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createModel } from "../../../../test/factories";
import { createResolvableModel } from "../../../../test/provider-model";

// RNX-192: every chat-facing model list (GET /models, the portal list, the "Available models" text) comes from
// getAllModels, which lists only models a chat call can resolve: active, on an active non-deleted provider record.
// Test database, real ModelRegistryService and ModelsController.
describe("RNX-192: the models list shows only resolvable models", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let registry: ModelRegistryService;
  let controller: ModelsController;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [ModelsController],
      providers: [ModelRegistryService],
    }));
    registry = moduleRef.get(ModelRegistryService);
    controller = moduleRef.get(ModelsController);
  });

  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  const listedSlugs = async (): Promise<string[]> => {
    await registry.refresh();
    const body = await controller.listModels();
    const registrySlugs = (await registry.getAllModels()).map((m) => m.slug);
    expect(body.data.map((m) => m.id)).toEqual(registrySlugs);
    return registrySlugs;
  };

  it("control: a model on an active provider is listed", async () => {
    await createResolvableModel(prisma, { slug: "list/active" });

    expect(await listedSlugs()).toEqual(["list/active"]);
  });

  it("negative (a): the list never contains a slug that has no model row", async () => {
    await createResolvableModel(prisma, { slug: "list/active" });
    const rowSlugs = (await prisma.aiModel.findMany()).map((m) => m.slug);

    const actualSlugs = await listedSlugs();

    expect(actualSlugs.every((slug) => rowSlugs.includes(slug))).toBe(true);
    expect(actualSlugs).not.toContain("list/no-such-row");
  });

  it("negative (b): a model whose providerRecordId is null is not listed", async () => {
    await createResolvableModel(prisma, { slug: "list/active" });
    await createModel(prisma, { providerRecordId: null, slug: "list/no-provider-record" });

    expect(await listedSlugs()).toEqual(["list/active"]);
  });

  it("negative (c): a model on an inactive provider is not listed", async () => {
    await createResolvableModel(prisma, { slug: "list/active" });
    await createResolvableModel(prisma, { slug: "list/inactive-provider", provider: { status: "inactive" } });

    expect(await listedSlugs()).toEqual(["list/active"]);
  });

  it("negative (d): a model on a soft-deleted provider is not listed", async () => {
    await createResolvableModel(prisma, { slug: "list/active" });
    await createResolvableModel(prisma, { slug: "list/deleted-provider", provider: { deletedAt: new Date() } });

    expect(await listedSlugs()).toEqual(["list/active"]);
  });
});
