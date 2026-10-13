import { Controller, Get } from "@nestjs/common";
import { ModelRegistryService } from "../../config/model-registry.service";

@Controller("models")
export class ModelsController {
  constructor(private readonly registry: ModelRegistryService) {}

  @Get()
  async listModels() {
    const [models, markup] = await Promise.all([
      this.registry.getAllModels(),
      this.registry.getMarkup(),
    ]);

    const data = models.map((config) => ({
      id: config.slug,
      name: config.modelName,
      provider: config.provider,
      pricing: {
        input: config.inputPrice.mul(markup).toNumber(),
        output: config.outputPrice.mul(markup).toNumber(),
        currency: "USD",
        unit: "per token",
      },
      max_tokens: config.maxTokens,
    }));

    return { object: "list", data };
  }
}
