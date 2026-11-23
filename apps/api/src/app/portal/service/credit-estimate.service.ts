import { BadRequestException, Injectable } from "@nestjs/common";
import { ModelRegistryService } from "../../config/model-registry.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { ProviderRouter } from "../../providers/provider-router";
import { callRatesOf } from "../../billing/utils/call-rates-of";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";
import { estimateCallCredits } from "../../billing/utils/estimate-call-credits";
import type { CreditEstimate } from "../types/credit-estimate";
import type { CreditEstimateInput } from "../types/credit-estimate-input";
import { resolveMaxTokens } from "../utils/resolve-max-tokens";

/** The decimals of a credit amount: one micro-credit (docs/credits.md section 2.4). */
const CREDIT_DECIMALS = 6;

/**
 * RNX-331: the worst case the reservation of one portal chat message would hold. It runs the reservation's own
 * function (`estimateCallCredits`) with the same rates and max_tokens the paid portal send resolves, over the untuned
 * prompt (the lower bound the send's own 402 pre-check uses: tuning embeds the query, a paid call). Read-only (D332):
 * no model call, no hold, no ledger write.
 */
@Injectable()
export class CreditEstimateService {
  constructor(
    private readonly registry: ModelRegistryService,
    private readonly entitlements: EntitlementService,
    private readonly providerRouter: ProviderRouter,
  ) {}

  /** The estimate for this user's message on this model; refused (400) for an unknown model or a tier the user's packages do not allow. */
  async estimate({ userId, model, messages }: CreditEstimateInput): Promise<CreditEstimate> {
    const connection = await this.registry.resolveConnection(model);
    const modelConfig = await this.registry.getModel(model);
    if (!modelConfig) throw new BadRequestException(`Model "${model}" is not supported`);
    await this.entitlements.requireModelTier(userId, modelConfig.tier);
    const tierRates = await this.registry.getTierRates(modelConfig.tier);
    if (!tierRates) throw new BadRequestException(`No credit rates found for tier "${modelConfig.tier}"`);
    const maxTokens = this.providerRouter.resolveMaxTokens({
      connection,
      max_tokens: resolveMaxTokens(undefined, modelConfig.maxOutputTokens, null),
    });
    const credits = estimateCallCredits(countPromptTokens(messages), maxTokens, callRatesOf(tierRates));
    return { credits: credits.toFixed(CREDIT_DECIMALS) };
  }
}
