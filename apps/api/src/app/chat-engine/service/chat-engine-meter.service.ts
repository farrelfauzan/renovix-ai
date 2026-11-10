import { Injectable } from "@nestjs/common";
import { RunBudgetStoppedError } from "../../agent/errors/run-budget-stopped.error";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import type { AgentRunBudget } from "../../agent/types/agent-run-budget";
import type { MeteredResponse } from "../../agent/types/metered-response";
import type { RunEnding } from "../../agent/types/run-ending";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import { ModelUnavailableException } from "../../config/errors/model-unavailable.exception";
import { ModelRegistryService } from "../../config/model-registry.service";
import type { ChatRequest } from "../../providers/provider.interface";
import type { ModelConnection } from "../../providers/types/model-connection";
import type { ChatExecutionChunk } from "../types/chat-execution-chunk";
import type { ChatModelCall } from "../types/chat-model-call";
import type { ChatModelRequest } from "../types/chat-model-request";
import type { MeteredExecutionChunk } from "../types/metered-execution-chunk";
import type { MeteredExecutionTarget } from "../types/metered-execution-target";
import type { MeteredRunState } from "../types/metered-run-state";

/**
 * RNX-282: the chat engine's model calls on the existing credit lifecycle, through the agent run's meter
 * (AgentRunMeterService over CreditService, docs/credits.md section 13); no ledger, rate or default of its own. The
 * agent's model is resolved first (ModelUnavailableException for an unknown model or an inactive provider: nothing
 * reserved, no provider call). The run's one reservation is opened at the execution's first model call, from that call
 * (402, the run-cap refusal and the 400 for a model without rates are refused before any hold or call); every call is
 * metered on it with its budget stop, one at a time (calls started together are queued, so each budget check sees the
 * previous call's charge; the queue is local to the execution, nothing is shared between runs or instances).
 * The run is closed exactly once, in `finally`, by how the execution ended: completed, budget stop (the stop message
 * is yielded as the answer), or failed: a provider error, an exception, a disconnect or an abort. A disconnect is the
 * consumer stopping iteration (generator `return()`): it takes effect at the engine's next yield, so a model call
 * already in flight finishes first. An abort is the caller's AbortSignal: it is checked before the reservation, before
 * and after every call, and when the execution ends, and it is passed on the provider request, so no further call
 * starts and nothing is persisted. A provider call already in flight is not cancelled by the current adapter (its
 * non-streaming `chat` sends only its own timeout): it finishes and stays charged, and the run stops right after it.
 */
@Injectable()
export class ChatEngineMeterService {
  constructor(
    private readonly meter: AgentRunMeterService,
    private readonly registry: ModelRegistryService,
  ) {}

  /** Runs `execute` with a metered model call for this target and yields its chunks; the run's reservation is closed once, however it ends. An aborted `signal` ends it as failed. */
  async *meterExecution(
    target: MeteredExecutionTarget,
    execute: (callModel: ChatModelCall) => AsyncIterable<ChatExecutionChunk>,
    signal?: AbortSignal,
  ): AsyncGenerator<MeteredExecutionChunk> {
    const run: MeteredRunState = { target, signal, connection: await this.resolveConnection(target.model), queue: Promise.resolve() };
    let ending: RunEnding = "failed";
    try {
      yield* execute((request) => this.queueCall(run, request));
      signal?.throwIfAborted();
      ending = "completed";
    } catch (err) {
      if (!(err instanceof RunBudgetStoppedError)) throw err;
      ending = "budget_stopped";
      yield { type: "budget_stopped", message: budgetStopMessage(err.held) };
    } finally {
      await run.queue;
      await this.closeOpenedRun(run.opened, ending);
    }
  }

  /** Queues one model call behind the run's previous one: it starts once that call has settled (charged or failed). */
  private queueCall(run: MeteredRunState, request: ChatModelRequest): Promise<MeteredResponse> {
    const call = run.queue.then(() => this.callOnRun(run, request));
    run.queue = call.catch(() => undefined);
    return call;
  }

  /**
   * One metered call on the run's agent model: the run's reservation is opened by its first call, from that call. An
   * aborted signal refuses the call before anything is reserved or called, and fails it once the provider has answered
   * (that answer stays charged), so the execution does no further work.
   */
  private async callOnRun(run: MeteredRunState, request: ChatModelRequest): Promise<MeteredResponse> {
    run.signal?.throwIfAborted();
    const call: ChatRequest = { ...request, model: run.connection.slug, connection: run.connection, ...(run.signal && { signal: run.signal }) };
    run.opened ??= this.meter.openRun({ runnerUserId: run.target.runnerUserId, workspaceId: run.target.workspaceId, firstCall: call, linkedAgents: [] });
    const metered = await this.meter.callModel(await run.opened, { agentId: run.target.agentId, parentCallId: null, request: call });
    run.signal?.throwIfAborted();
    return metered;
  }

  /** The agent's model's connection; ModelUnavailableException for an unknown model or one whose provider is not usable. */
  private async resolveConnection(model: string): Promise<ModelConnection> {
    const resolved = await this.registry.resolveModel(model);
    if (!resolved) throw new ModelUnavailableException();
    return this.registry.resolveConnection(resolved.slug);
  }

  /** Closes the run when its reservation was placed; a refused reservation (nothing held) has nothing to close. */
  private async closeOpenedRun(opened: Promise<AgentRunBudget> | undefined, ending: RunEnding): Promise<void> {
    const run = await opened?.catch(() => undefined);
    if (run) await this.meter.closeRun(run, ending);
  }
}
