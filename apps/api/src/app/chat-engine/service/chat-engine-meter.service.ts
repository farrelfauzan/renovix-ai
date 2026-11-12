import { Injectable } from "@nestjs/common";
import { RunBudgetStoppedError } from "../../agent/errors/run-budget-stopped.error";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import type { AgentRunBudget } from "../../agent/types/agent-run-budget";
import type { RunEnding } from "../../agent/types/run-ending";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import { ModelUnavailableException } from "../../config/errors/model-unavailable.exception";
import { ModelRegistryService } from "../../config/model-registry.service";
import type { ChatRequest } from "../../providers/provider.interface";
import type { ModelConnection } from "../../providers/types/model-connection";
import type { ChargedResponse } from "../types/charged-response";
import type { ChatExecutionChunk } from "../types/chat-execution-chunk";
import type { ChatHopTarget } from "../types/chat-hop-target";
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
 * starts and nothing is persisted. RNX-283: a provider call already in flight is cancelled too (the adapter's `chat`
 * request carries the signal, and an aborted call is not retried): like any failed call it gets a provider_error usage
 * entry of 0, so nothing is debited for it, and the run is closed as failed: released when no call was charged,
 * otherwise settled for the calls that completed. RNX-25 (D341 D1): the reservation counts the target's linked agents
 * (as AgentRunMeterService.meterRun does); `onReserved` runs once, after the reservation holds and before the first
 * call; a hop's call (ChatHopTarget) is metered on the same reservation against the called agent's connection with its
 * parent call; and every call returns its charge (what the run's spent grew by), the run's cost being their sum.
 */
@Injectable()
export class ChatEngineMeterService {
  constructor(
    private readonly meter: AgentRunMeterService,
    private readonly registry: ModelRegistryService,
  ) {}

  /**
   * Runs `execute` with a metered model call for this target and yields its chunks; the run's reservation is closed once,
   * however it ends. An aborted `signal` ends it as failed. `onReserved` runs once the reservation holds (RNX-25).
   */
  async *meterExecution(
    target: MeteredExecutionTarget,
    execute: (callModel: ChatModelCall) => AsyncIterable<ChatExecutionChunk>,
    signal?: AbortSignal,
    onReserved?: () => Promise<void>,
  ): AsyncGenerator<MeteredExecutionChunk> {
    const run: MeteredRunState = { target, signal, connection: await this.resolveConnection(target.model), queue: Promise.resolve(), onReserved };
    let ending: RunEnding = "failed";
    try {
      yield* execute((request, hop) => this.queueCall(run, request, hop));
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
  private queueCall(run: MeteredRunState, request: ChatModelRequest, hop?: ChatHopTarget): Promise<ChargedResponse> {
    const call = run.queue.then(() => this.callOnRun(run, request, hop));
    run.queue = call.catch(() => undefined);
    return call;
  }

  /**
   * One metered call on the run's agent model: the run's reservation is opened by its first call, from that call. An
   * aborted signal refuses the call before anything is reserved or called, and fails it once the provider has answered
   * (that answer stays charged), so the execution does no further work. A hop's call (`hop`) runs on the called agent's
   * connection, with its agent and parent call on the usage entry.
   */
  private async callOnRun(run: MeteredRunState, request: ChatModelRequest, hop?: ChatHopTarget): Promise<ChargedResponse> {
    run.signal?.throwIfAborted();
    const connection = hop?.connection ?? run.connection;
    const call: ChatRequest = { ...request, model: connection.slug, connection, ...(run.signal && { signal: run.signal }) };
    const budget = await this.openOnce(run, call);
    const spentBefore = budget.spent;
    const metered = await this.meter.callModel(budget, { agentId: hop?.agentId ?? run.target.agentId, parentCallId: hop?.parentCallId ?? null, request: call });
    run.signal?.throwIfAborted();
    return { ...metered, charge: budget.spent.minus(spentBefore) };
  }

  /** The run's reservation, opened by its first call (from that call, with the target's linked agents); `onReserved` runs once it holds. */
  private async openOnce(run: MeteredRunState, firstCall: ChatRequest): Promise<AgentRunBudget> {
    if (run.opened) return run.opened;
    run.opened = this.meter.openRun({ runnerUserId: run.target.runnerUserId, workspaceId: run.target.workspaceId, firstCall, linkedAgents: run.target.linkedAgents ?? [] });
    const budget = await run.opened;
    await run.onReserved?.();
    return budget;
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
