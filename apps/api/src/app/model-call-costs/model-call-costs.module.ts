import { Global, Module } from "@nestjs/common";
import { ModelCallCostService } from "./service/model-call-cost.service";

/**
 * RNX-162: per-call model cost capture (model_call_costs). Global, like the repositories, because CreditService, which
 * every model call path provides, writes each call's row through it. Its repositories (model_call_costs and
 * exchange_rates) come from RepositoriesModule.
 */
@Global()
@Module({
  providers: [ModelCallCostService],
  exports: [ModelCallCostService],
})
export class ModelCallCostsModule {}
