import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { ModelRegistryService } from "../../config/model-registry.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { KnowledgeChunkRepository } from "../../knowledge/repository/knowledge-chunk.repository";
import { ProviderRouter } from "../../providers/provider-router";
import { callRatesOf } from "../../billing/utils/call-rates-of";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";
import { estimateCallCredits } from "../../billing/utils/estimate-call-credits";
import type { CreditEstimate } from "../types/credit-estimate";
import type { CreditEstimateInput } from "../types/credit-estimate-input";
import { resolveMaxTokens } from "../utils/resolve-max-tokens";

/** The decimals of a credit amount: one micro-credit (docs/credits.md section 2.4). */
const CREDIT_DECIMALS = 6;
/** The platform setting with the credits added for each knowledge search that can run (D390); no value in code (D391). */
const ALLOWANCE_SETTING = "knowledgeSearchAllowanceCredits";

/**
 * RNX-331 (D390, D391): the "up to N credits" of one portal chat message. N is the send's own estimate function
 * (`estimateCallCredits`, the same rates and max_tokens resolution) over the prompt after the free tuning parts ran
 * for real (system prompt, template match with its output limit, the user's memories: `applyTuning` without the
 * knowledge searches), plus the `knowledgeSearchAllowanceCredits` setting once for each knowledge search that can run
 * (the user's when the user has a knowledge chunk, the system's when the system knowledge base has one). Read-only
 * (D332): no embedding, no model call, no hold, no ledger write.
 */
@Injectable()
export class CreditEstimateService {
  private readonly logger = new Logger(CreditEstimateService.name);

  constructor(
    private readonly registry: ModelRegistryService,
    private readonly entitlements: EntitlementService,
    private readonly providerRouter: ProviderRouter,
    private readonly settings: PlatformSettingsService,
    private readonly promptTuning: PromptTuningService,
    private readonly knowledgeChunks: KnowledgeChunkRepository,
  ) {}

  /**
   * The estimate for this user's message on this model; refused (400) for an unknown model or a tier the user's
   * packages do not allow. `credits` is null (and one log line names the setting) when the allowance setting is not set.
   */
  async estimate({ userId, model, messages }: CreditEstimateInput): Promise<CreditEstimate> {
    const connection = await this.registry.resolveConnection(model);
    const modelConfig = await this.registry.getModel(model);
    if (!modelConfig) throw new BadRequestException(`Model "${model}" is not supported`);
    await this.entitlements.requireModelTier(userId, modelConfig.tier);
    const tierRates = await this.registry.getTierRates(modelConfig.tier);
    if (!tierRates) throw new BadRequestException(`No credit rates found for tier "${modelConfig.tier}"`);
    const allowance = await this.settings.getSetting(ALLOWANCE_SETTING);
    if (allowance === null) {
      this.logger.warn(`Credit estimate shows no figure: the platform setting ${ALLOWANCE_SETTING} is not set`);
      return { credits: null };
    }
    const [{ tunedMessages, matchedTemplate }, searches] = await Promise.all([
      this.promptTuning.applyTuning(messages, userId, { searchKnowledge: false }),
      this.countKnowledgeSearches(userId),
    ]);
    const maxTokens = this.providerRouter.resolveMaxTokens({
      connection,
      max_tokens: resolveMaxTokens(undefined, modelConfig.maxOutputTokens, matchedTemplate?.outputFormat || null),
    });
    const callCredits = estimateCallCredits(countPromptTokens(tunedMessages), maxTokens, callRatesOf(tierRates));
    return { credits: callCredits.plus(new Decimal(allowance).times(searches)).toFixed(CREDIT_DECIMALS) };
  }

  /** The knowledge searches the send can run for this user (0, 1 or 2), from one existence query each, no embedding. */
  private async countKnowledgeSearches(userId: string): Promise<number> {
    const searchable = await Promise.all([this.knowledgeChunks.hasPersonalChunks(userId), this.knowledgeChunks.hasSystemChunks()]);
    return searchable.filter(Boolean).length;
  }
}
