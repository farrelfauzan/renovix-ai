import { Prisma } from "@generated/prisma/client.js";
import { ModelsController } from "./models.controller";
import type { ModelRegistryService } from "../../config/model-registry.service";

describe("ModelsController.listModels (RNX-82: tier)", () => {
  it("answers each model's tier", async () => {
    const mockModel = {
      slug: "claude-sonnet",
      modelName: "Sonnet",
      provider: "anthropic",
      tier: "standard",
      inputPrice: new Prisma.Decimal(1),
      outputPrice: new Prisma.Decimal(2),
      maxTokens: 1000,
    };
    const registry = {
      getAllModels: async () => [mockModel],
      getMarkup: async () => new Prisma.Decimal(1),
    } as unknown as ModelRegistryService;

    const actualList = await new ModelsController(registry).listModels();

    expect(actualList.data[0]).toMatchObject({ id: "claude-sonnet", tier: "standard" });
  });
});
