import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../model-registry.service";
import { ModelUnavailableException } from "../errors/model-unavailable.exception";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createModel } from "../../../../test/factories";
import { createResolvableModel } from "../../../../test/provider-model";

// RX-178 AC "hard-coded callers removed": agent-run.controller, agent.service and channel.controller no longer name a
// vendor model; they call resolveCheapestConnection("standard"), which picks the cheapest active Standard model that
// a chat call can resolve (its provider record active and live). Test database, real ModelRegistryService.
describe("RX-178: resolveCheapestConnection (the former hard-coded callers)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let registry: ModelRegistryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      providers: [ModelRegistryService],
    }));
    registry = moduleRef.get(ModelRegistryService);
  });

  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  it("picks the cheapest Standard model on an active provider, skipping a cheaper one on an inactive provider and a cheaper Advanced one", async () => {
    const usable = await createResolvableModel(prisma, { slug: "std/usable", inputPrice: "0.000002", outputPrice: "0.000002" });
    await createResolvableModel(prisma, { slug: "std/pricier", inputPrice: "0.000009", outputPrice: "0.000009" });
    await createResolvableModel(prisma, { slug: "adv/cheaper", tier: "advanced", inputPrice: "0.0000001", outputPrice: "0.0000001" });
    const inactive = await createResolvableModel(prisma, { slug: "std/cheaper-but-inactive-provider", provider: { status: "inactive" } });
    await prisma.aiModel.update({ where: { id: inactive.model.id }, data: { inputPrice: "0.0000001", outputPrice: "0.0000001" } });
    await registry.refresh();

    const actualConnection = await registry.resolveCheapestConnection("standard");

    expect(actualConnection).toMatchObject({ slug: "std/usable", providerName: usable.provider.name });
  });

  it("negative: no Standard model is resolvable (only one without a provider record) → ModelUnavailableException (400)", async () => {
    const { provider } = await createResolvableModel(prisma, { slug: "adv/only", tier: "advanced" });
    await createModel(prisma, { providerRecordId: null, slug: "std/no-provider-record" });
    expect(provider.status).toBe("active");
    await registry.refresh();

    await expect(registry.resolveCheapestConnection("standard")).rejects.toBeInstanceOf(ModelUnavailableException);
  });
});
