import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/client";
import { CreditService } from "../../billing/service/credit.service";
import { callRatesOf } from "../../billing/utils/call-rates-of";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";
import { estimateCallCredits } from "../../billing/utils/estimate-call-credits";
import { tokensFromUsage } from "../../billing/utils/tokens-from-usage";
import { failedAttemptRecord } from "../../billing/utils/failed-attempt-record";
import type { ServedBy } from "../../providers/types/served-by";
import { ModelRegistryService } from "../../config/model-registry.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import type { CallRates } from "../../billing/types/call-rates";
import type { ChatRequest, ChatResponse } from "../../providers/provider.interface";
import { ProviderRouter } from "../../providers/provider-router";
import { UsageService } from "../../usage/service/usage.service";
import { RunBudgetStoppedError } from "../errors/run-budget-stopped.error";
import { RunCapExceededException } from "../errors/run-cap-exceeded.exception";
import type { AgentRunBudget } from "../types/agent-run-budget";
import type { CallCharge } from "../types/call-charge";
import type { LinkedAgent } from "../types/linked-agent";
import type { MeteredCall } from "../types/metered-call";
import type { MeteredResponse } from "../types/metered-response";
import type { MeteredRun } from "../types/metered-run";
import type { RunStart } from "../types/run-start";
import type { TierCallRates } from "../types/tier-call-rates";
import { estimateRunCredits } from "../utils/estimate-run-credits";

/** The per-run credit cap without a platform setting row (docs/credits.md section 13.2, D115 item 7, D202 item 4). */
const DEFAULT_RUN_CAP_CREDITS = 10;
/** The lowest per-run cap without a platform setting row (docs/credits.md section 13.2, D115 item 7). */
const DEFAULT_RUN_CAP_FLOOR_CREDITS = 1;
/** Agent calls per run without a platform setting row (D77 Q5; docs/credits.md section 13.3, L). */
const DEFAULT_AGENT_CALLS_PER_RUN = 5;
/** The max_tokens a sub-agent call sends when its agent sets none (executeSubAgent). */
const SUB_AGENT_DEFAULT_MAX_TOKENS = 4096;
const NO_CREDITS = new Decimal(0);

/**
 * Agent runs on the credit ledger (RX-22b, docs/credits.md section 13): one reservation per agent message, one usage
 * entry and one usage row per model call (root or hop) with the runner, the run, the agent and the parent call, a
 * budget stop before every call, and settle or release at the end. All balance math stays in CreditService.
 */
@Injectable()
export class AgentRunMeterService {
  private readonly logger = new Logger(AgentRunMeterService.name);

  constructor(
    private readonly credits: CreditService,
    private readonly settings: PlatformSettingsService,
    private readonly registry: ModelRegistryService,
    private readonly providerRouter: ProviderRouter,
    private readonly usage: UsageService,
  ) {}

  /**
   * Runs `work` as one agent run: reserves H = min(cap, available) once (402 when available < min(E_run, cap); a
   * RunCapExceededException when the first call alone is over the cap), then settles the run when the work ends or
   * stops at its budget (status budget_stopped). Any other error is rethrown after closing the reservation: settled
   * when calls were charged (docs/credits.md section 2, I6: released means nothing charged), else released.
   */
  async meterRun<T>(start: RunStart, work: (run: AgentRunBudget) => Promise<T>): Promise<MeteredRun<T>> {
    const run = await this.openRun(start);
    try {
      const value = await work(run);
      await this.credits.settle(run.reservationId);
      return { status: "completed", value };
    } catch (err) {
      if (!(err instanceof RunBudgetStoppedError)) {
        await (run.spent.isZero() ? this.credits.release(run.reservationId) : this.credits.settle(run.reservationId));
        throw err;
      }
      await this.credits.settle(run.reservationId);
      return { status: "budget_stopped", held: run.held };
    }
  }

  /**
   * RNX-200: the refusals of a run answered before its stream opens and before any model call (docs/credits.md
   * sections 13.2 and 13.3), on `firstCall`, a lower bound of the root agent's first request (the real one only adds
   * prompt): the 400 for a model without credit rates, RunCapExceededException when that call alone is over the cap,
   * and 402 CREDITS_EXHAUSTED when the paid wallet cannot cover it. A run that `meterRun` would reserve passes it.
   * Reads only.
   */
  async assertRunCanStart(start: Omit<RunStart, "linkedAgents">): Promise<void> {
    const cap = await this.readRunCap();
    const rootCall = this.estimateCall(start.firstCall, (await this.ratesOf(start.firstCall.connection.slug)).rates);
    if (rootCall.greaterThan(cap)) throw new RunCapExceededException(cap);
    await this.credits.assertAvailable(start.runnerUserId, rootCall);
  }

  /**
   * One model call of a run (docs/credits.md sections 3.1 and 13.4): RunBudgetStoppedError, without calling, when
   * spent + E_call would exceed the hold; otherwise calls the provider and writes the call's usage entry (and its
   * usage row). A provider error is charged 0 (outcome provider_error) and rethrown.
   */
  async callModel(run: AgentRunBudget, call: MeteredCall): Promise<MeteredResponse> {
    const { tier, rates } = await this.ratesOf(call.request.connection.slug);
    if (run.spent.plus(this.estimateCall(call.request, rates)).greaterThan(run.held)) throw new RunBudgetStoppedError(run.held);
    const usage = {
      reservationId: run.reservationId,
      memberUserId: run.runnerUserId,
      requestId: run.runId,
      runId: run.runId,
      callId: randomUUID(),
      agentId: call.agentId,
      parentCallId: call.parentCallId,
      modelId: call.request.connection.slug,
      tier,
      rates,
    };
    const startedAt = Date.now();
    // RNX-179: each attempt that falls over to a fallback model is its own provider_error entry under the run's
    // reservation (docs/credits.md section 3.1 rule 6); the call's entry names the last model tried.
    let triedSlug = usage.modelId;
    const hooks = {
      onAttempt: (tried: ServedBy) => void (triedSlug = tried.slug),
      onAttemptFailed: async (failed: ServedBy) => void (await this.credits.recordUsage(failedAttemptRecord(usage, failed))),
    };
    const response = await this.providerRouter.chat(call.request, hooks).catch(async (err: unknown) => {
      await this.credits.recordUsage({ ...usage, modelId: triedSlug, tokens: tokensFromUsage(0, 0, 0), outcome: "provider_error" });
      throw err;
    });
    const tokens = tokensFromUsage(response.usage.prompt_tokens, response.usage.cachedTokens ?? 0, response.usage.completion_tokens);
    const entry = await this.credits.recordUsage({ ...usage, modelId: triedSlug, tokens, outcome: "completed" });
    run.spent = run.spent.plus(entry.amount.negated());
    await this.logCallUsage(run, call.request, response, { cost: entry.amount.negated(), latencyMs: Date.now() - startedAt });
    return { response, callId: usage.callId };
  }

  /** The usage row of one metered call (usage_logs; cost = the credits its usage entry charged). A failed write is only logged. */
  private async logCallUsage(run: AgentRunBudget, request: ChatRequest, response: ChatResponse, charge: CallCharge): Promise<void> {
    await this.usage
      .logUsage({
        userId: run.runnerUserId,
        model: (response.servedBy ?? request.connection).slug,
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        cost: charge.cost,
        latencyMs: charge.latencyMs,
        provider: (response.servedBy ?? request.connection).providerName,
      })
      .catch((err) => this.logger.error("Failed to log agent usage", err));
  }

  /** Reserves the run's hold after the pre-run checks (docs/credits.md sections 13.2 and 13.3). */
  private async openRun(start: RunStart): Promise<AgentRunBudget> {
    const [cap, agentCallSetting] = await Promise.all([this.readRunCap(), this.settings.getSetting("peerRunMaxAgentCalls")]);
    const rootCall = this.estimateCall(start.firstCall, (await this.ratesOf(start.firstCall.connection.slug)).rates);
    if (rootCall.greaterThan(cap)) throw new RunCapExceededException(cap);
    const linkedCalls = await Promise.all(start.linkedAgents.map((agent) => this.estimateLinkedCall(agent)));
    const estimate = estimateRunCredits(rootCall, linkedCalls, agentCallSetting ?? DEFAULT_AGENT_CALLS_PER_RUN);
    const runId = randomUUID();
    const reservation = await this.credits.reserveRun({ userId: start.runnerUserId, runId, cap, minimum: Decimal.min(estimate, cap) });
    return { runId, reservationId: reservation.id, runnerUserId: start.runnerUserId, held: reservation.amountHeld, spent: NO_CREDITS };
  }

  /** The per-run cap (docs/credits.md section 13.2): the platform setting, never below its floor. */
  private async readRunCap(): Promise<Decimal> {
    const [capSetting, floorSetting] = await Promise.all([
      this.settings.getSetting("perRunCreditCap"),
      this.settings.getSetting("perRunCreditCapFloor"),
    ]);
    return Decimal.max(capSetting ?? DEFAULT_RUN_CAP_CREDITS, floorSetting ?? DEFAULT_RUN_CAP_FLOOR_CREDITS);
  }

  /** E_call of one request (docs/credits.md section 3.1 rule 1): its counted prompt and tools, and the max_tokens the adapter sends. */
  private estimateCall(request: ChatRequest, rates: CallRates): Decimal {
    return estimateCallCredits(countPromptTokens(request.messages, request.tools ?? []), this.providerRouter.resolveMaxTokens(request), rates);
  }

  /**
   * E_call of a linked agent (docs/credits.md section 13.3): its system prompt (a delegated call has no tools) and
   * its max_tokens; no task allowance (no such setting exists). An agent whose model cannot be resolved adds nothing:
   * its hop fails before any model call.
   */
  private async estimateLinkedCall(agent: LinkedAgent): Promise<Decimal> {
    const model = await this.registry.resolveModel(agent.model);
    if (!model) return NO_CREDITS;
    const { rates } = await this.ratesOf(model.slug);
    const prompt = countPromptTokens([{ role: "system", content: agent.systemPrompt }]);
    return estimateCallCredits(prompt, agent.maxTokens ?? SUB_AGENT_DEFAULT_MAX_TOKENS, rates);
  }

  /** The tier rates (RX-21) of the model with this slug; 400 when the model or its tier has none. */
  private async ratesOf(slug: string): Promise<TierCallRates> {
    const model = await this.registry.getModel(slug);
    const tierRates = model && (await this.registry.getTierRates(model.tier));
    if (!model || !tierRates) throw new BadRequestException(`No credit rates found for model "${slug}"`);
    return { tier: model.tier, rates: callRatesOf(tierRates) };
  }
}
