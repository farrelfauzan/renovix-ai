import { ChatEngineMeterService } from "../../chat-engine/service/chat-engine-meter.service";
import type { ChatExecutionChunk } from "../../chat-engine/types/chat-execution-chunk";
import type { ChatModelCall } from "../../chat-engine/types/chat-model-call";
import type { MeteredExecutionChunk } from "../../chat-engine/types/metered-execution-chunk";
import type { MeteredExecutionTarget } from "../../chat-engine/types/metered-execution-target";
import type { ModelRegistryService } from "../../config/model-registry.service";
import type { AgentRunMeterService } from "../service/agent-run-meter.service";
import type { HopModelCall } from "../types/hop-model-call";

/**
 * RNX-121b-1: the meter of a called agent's run on the chat engine. It opens no reservation of its own: every model
 * call goes through the caller's metered call, so it is metered on the run's one reservation with the budget stop
 * before it, and its usage entry names the called agent, the run, the calling model call and the runner. A deeper
 * hop's call passes through with its own target. Each call is one attempt within the per-call deadline
 * (`singleAttemptTimeoutMs`: no retry, and its deadline is not counted by the circuit breaker) and its connection has
 * no fallback models (D331). A budget stop is not caught here: it ends the whole run.
 */
export class AgentHopMeter extends ChatEngineMeterService {
  constructor(
    meter: AgentRunMeterService,
    registry: ModelRegistryService,
    private readonly hop: HopModelCall,
  ) {
    super(meter, registry);
  }

  /** Runs `execute` with the hop's model call and yields its chunks; nothing is reserved or closed here. */
  override async *meterExecution(
    _target: MeteredExecutionTarget,
    execute: (callModel: ChatModelCall) => AsyncIterable<ChatExecutionChunk>,
  ): AsyncGenerator<MeteredExecutionChunk> {
    const { callerCallModel, target, timeoutMs } = this.hop;
    yield* execute((request, hop) => callerCallModel({ ...request, singleAttemptTimeoutMs: timeoutMs }, hop ?? target));
  }
}
