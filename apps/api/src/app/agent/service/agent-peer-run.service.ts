import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { errorName } from "../../../common/utils/error-name";
import { CHAT_ENGINE_PEER_UNAVAILABLE } from "../../chat-engine/config/chat-engine.config";
import type { ChatEnginePeerCall } from "../../chat-engine/ports/chat-engine-peer-call.port";
import { ChatEngineContextService } from "../../chat-engine/service/chat-engine-context.service";
import { ChatEngineService } from "../../chat-engine/service/chat-engine.service";
import { ChatEngineToolLoop } from "../../chat-engine/service/chat-engine-tool-loop.service";
import { ModelUnavailableException } from "../../config/errors/model-unavailable.exception";
import { ModelRegistryService } from "../../config/model-registry.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import type { ModelConnection } from "../../providers/types/model-connection";
import { AgentHopExecution } from "../adapters/agent-hop-execution.adapter";
import { AgentHopMeter } from "../adapters/agent-hop-meter.adapter";
import { AgentHopPersistence } from "../adapters/agent-hop-persistence.adapter";
import { AgentPeerCall } from "../adapters/agent-peer-call.adapter";
import { AgentRunOutputApproval } from "../adapters/agent-run-output-approval.adapter";
import { PEER_RUN_LIMIT_SETTINGS } from "../config/peer-run-limit-settings";
import { RunBudgetStoppedError } from "../errors/run-budget-stopped.error";
import { RunLimitStoppedError } from "../errors/run-limit-stopped.error";
import { AgentRepository } from "../repository/agent.repository";
import { AgentRunRepository } from "../repository/agent-run.repository";
import type { AgentRunSessionRow } from "../types/agent-run-session-row";
import type { ChannelPeerCallInput } from "../types/channel-peer-call-input";
import type { HopEnding } from "../types/hop-ending";
import type { PeerCall } from "../types/peer-call";
import type { PeerCallFrame } from "../types/peer-call-frame";
import type { PeerHop } from "../types/peer-hop";
import type { PeerRunLimits } from "../types/peer-run-limits";
import type { PeerRunState } from "../types/peer-run-state";
import type { RootPeerCallInput } from "../types/root-peer-call-input";
import { createMcpRunSession } from "../utils/create-mcp-run-session";
import { findPeerRefusal } from "../utils/find-peer-refusal";
import { toHopEvent } from "../utils/to-hop-event";
import { toHopRequest } from "../utils/to-hop-request";
import { toHopStatus } from "../utils/to-hop-status";
import { toPeerHop } from "../utils/to-peer-hop";
import { toRunTimeLimitMs } from "../utils/to-run-time-limit-ms";
import { AgentLinkService } from "./agent-link.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AgentToolService } from "./agent-tool.service";

/** Milliseconds per second of the `peerRunCallTimeoutSeconds` setting. */
const MS_PER_SECOND = 1000;
/** RNX-326: milliseconds per minute of the `peerRunMaxMinutes` setting. */
const MS_PER_MINUTE = 60_000;

/**
 * RNX-121b-1: the agent calls of an agent run (call_agent behind the chat engine's peer port, D323). A called agent
 * runs as a full agent on the chat engine: its own prompt and model, its tools on the runner's connections (RNX-119),
 * its knowledge (RNX-116's check), its memory read as context (never extracted), the input and output guardrails, and
 * only its task as input; its approved answer is the caller's tool result, and it may call its own links. Every model
 * call is metered on the run's one reservation (AgentHopMeter), one attempt within `peerRunCallTimeoutSeconds`, with no
 * fallback model. Limits come from the platform settings only: a missing row makes the call unavailable (a log line
 * names it). A cycle, the depth and agent-call limits and a missing setting refuse the call with a `refused` child
 * row; a failed or timed-out call gives the caller an error result and the run goes on; a budget stop ends the run.
 * Every hop gets one child row (RNX-302); a hop's own hops end before its row exists, so they are kept in its record
 * and written after it, in order. The run's state lives in its own request and is passed by reference: nothing is
 * shared between requests or API instances. RNX-326: from the run's first agent call, its model-call cap
 * (peerRunMaxModelCalls) and run time limit (peerRunMaxMinutes, cut at the route's socket timeout) apply: at either one
 * the run stops (RunLimitStoppedError) with the budget-stop answer, and a hop stopped by the time limit is `timeout`.
 * RNX-328: every hop that gets a child row reports its start, and its end with the row's status, to the peer port's
 * request (`onHopEvent`); a called agent's own hops report through its caller's.
 */
@Injectable()
export class AgentPeerRunService {
  private readonly logger = new Logger(AgentPeerRunService.name);

  constructor(
    private readonly registry: ModelRegistryService,
    private readonly tools: AgentToolService,
    private readonly guardrail: GuardrailService,
    private readonly agents: AgentRepository,
    private readonly policy: AgentRunPolicyService,
    private readonly contexts: ChatEngineContextService,
    private readonly meter: AgentRunMeterService,
    private readonly links: AgentLinkService,
    private readonly runs: AgentRunRepository,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** The peer port of an agent message's own agent (depth 0) on the run's state: each of its hops is written once it ends, under the message's session row. */
  createRootPeerCall(input: RootPeerCallInput): ChatEnginePeerCall {
    const { turn, agent, callableAgents, state } = input;
    const record = (hop: PeerHop) => this.writeHop(hop, (turn.run as AgentRunSessionRow).id, turn.userId);
    return new AgentPeerCall(this, { state, agent, depth: 0, callableAgents, record });
  }

  /**
   * RNX-24a: the peer port of a channel chat message's agent (depth 0) on the run's state: each of its hops is written
   * once it ends, under the channel run's agent_runs row (D380), which `findParentRunId` writes on its first ask.
   */
  createChannelPeerCall(input: ChannelPeerCallInput): ChatEnginePeerCall {
    const { agent, callableAgents, state, findParentRunId } = input;
    const record = async (hop: PeerHop) => this.writeHop(hop, await findParentRunId(), state.runnerUserId);
    return new AgentPeerCall(this, { state, agent, depth: 0, callableAgents, record });
  }

  /**
   * One agent call: refused (with its `refused` row) when a limit setting is missing or a limit is reached, otherwise
   * run. RNX-326: the run's limits start at its first agent call whose settings are all set.
   */
  async callAgent(call: PeerCall): Promise<string> {
    const limits = await this.readLimits();
    if (!limits) return this.refuse(call, CHAT_ENGINE_PEER_UNAVAILABLE);
    this.startRunLimits(call.frame.state, limits);
    const refusal = findPeerRefusal(call, limits);
    if (refusal) return this.refuse(call, refusal);
    call.frame.state.agentCalls++;
    return this.runHop(call, limits);
  }

  /** The limits from the platform settings, or null (logged with the missing names) when a row is missing. */
  private async readLimits(): Promise<PeerRunLimits | null> {
    const values = await Promise.all(PEER_RUN_LIMIT_SETTINGS.map((name) => this.settings.getSetting(name)));
    const [maxDepth, maxAgentCalls, callTimeoutSeconds, maxModelCalls, maxMinutes] = values;
    if (maxDepth !== null && maxAgentCalls !== null && callTimeoutSeconds !== null && maxModelCalls !== null && maxMinutes !== null) {
      return { maxDepth, maxAgentCalls, callTimeoutMs: callTimeoutSeconds * MS_PER_SECOND, maxModelCalls, maxRunMs: maxMinutes * MS_PER_MINUTE };
    }
    const missing = PEER_RUN_LIMIT_SETTINGS.filter((_name, i) => values[i] === null);
    this.logger.warn(`Agent call unavailable: the platform setting ${missing.join(", ")} is not set`);
    return null;
  }

  /**
   * RNX-326: once per run, at its first agent call: the model-call cap (counted from the run's start, root and hops;
   * the run's execution enforces it) and the stop timer at the run time limit (RNX-351: within the run's own limit, when
   * it has one), counted from the run's start. When it fires, the model call running is aborted with
   * RunLimitStoppedError and no further call starts; the run's execution clears it when the run ends, however it ends.
   */
  private startRunLimits(state: PeerRunState, limits: PeerRunLimits): void {
    if (state.maxModelCalls !== undefined) return;
    const delayMs = state.startedAt + toRunTimeLimitMs({ maxRunMs: limits.maxRunMs, runTimeLimitMs: state.runTimeLimitMs, socketTimeoutMs: state.socketTimeoutMs }) - Date.now();
    state.maxModelCalls = limits.maxModelCalls;
    state.stopTimer = setTimeout(() => {
      this.logger.warn(`Agent run stopped at its time limit (${state.stack[0]})`);
      state.stop.abort(new RunLimitStoppedError("run_time"));
    }, delayMs);
  }

  /** A refused call: nothing runs; its `refused` row is recorded and the caller gets the refusal. */
  private async refuse(call: PeerCall, message: string): Promise<string> {
    this.logger.warn(`Agent call refused: ${call.frame.agent.id} -> ${call.callee.id}: ${message}`);
    call.request.onHopEvent(toHopEvent(call));
    await call.frame.record(toPeerHop(call, { status: "refused", answer: message, durationMs: 0, children: [] }));
    call.request.onHopEvent(toHopEvent(call, "refused"));
    return message;
  }

  /** Runs the called agent on the call stack and records how it ended; a budget stop or (RNX-326) a run-limit stop is rethrown (it ends the whole run). */
  private async runHop(call: PeerCall, limits: PeerRunLimits): Promise<string> {
    const startedAt = Date.now();
    const children: PeerHop[] = [];
    call.request.onHopEvent(toHopEvent(call));
    call.frame.state.stack.push(call.callee.id);
    const ending = await this.runCallee(call, limits, children)
      .then((answer): HopEnding => ({ status: "completed", answer, failure: null }))
      .catch((err: unknown) => this.toFailedEnding(call, err))
      .finally(() => call.frame.state.stack.pop());
    await call.frame.record(toPeerHop(call, { status: ending.status, answer: ending.answer, durationMs: Date.now() - startedAt, children }));
    call.request.onHopEvent(toHopEvent(call, ending.status));
    if (ending.failure instanceof RunBudgetStoppedError || ending.failure instanceof RunLimitStoppedError) throw ending.failure;
    return ending.answer;
  }

  /** A failed hop: its status (budget stop, timeout (RNX-326: the run time limit too) or error, an abort included) and the error result its caller gets. */
  private toFailedEnding(call: PeerCall, err: unknown): HopEnding {
    const status = toHopStatus(err);
    this.logger.warn(`Agent call ${status}: ${call.frame.agent.id} -> ${call.callee.id} (${errorName(err)})`);
    return { status, answer: `Error: ${(err as Error).message}`, failure: err };
  }

  /** The called agent's run on the chat engine, with only its task; its own hops go to `children`. Its approved answer. */
  private async runCallee(call: PeerCall, limits: PeerRunLimits, children: PeerHop[]): Promise<string> {
    const { frame, callee, request } = call;
    const connection = await this.resolveConnection(callee.model);
    const callableAgents = await this.links.listCallableAgents(callee, frame.state.scope);
    const calleeFrame: PeerCallFrame = { state: frame.state, agent: callee, depth: frame.depth + 1, callableAgents, record: async (hop) => void children.push(hop) };
    const target = { agentId: callee.id, connection: { ...connection, fallbacks: [] }, parentCallId: request.parentCallId };
    const meter = new AgentHopMeter(this.meter, this.registry, { callerCallModel: request.callModel, target, timeoutMs: limits.callTimeoutMs });
    const mcpSession = { ...createMcpRunSession(), returnsDocumentsAsText: true };
    const result = await this.createHopEngine(calleeFrame, meter).collect(toHopRequest(call, callableAgents), { signal: frame.state.signal, mcpSession, onHopEvent: request.onHopEvent });
    if (result.status === "denied") throw new NotFoundException("Agent not found");
    return result.content ?? "";
  }

  /** The called agent's own chat engine: its tool loop with its own peer port, the output guardrail, and no persistence. */
  private createHopEngine(frame: PeerCallFrame, meter: AgentHopMeter): ChatEngineService {
    const loop = new ChatEngineToolLoop(this.tools, new AgentPeerCall(this, frame));
    const execution = new AgentHopExecution(loop, frame.callableAgents);
    return new ChatEngineService(this.agents, this.policy, this.guardrail, this.contexts, meter, execution, new AgentRunOutputApproval(this.guardrail), new AgentHopPersistence());
  }

  /** The called agent's model's connection; ModelUnavailableException (a failed hop) when it cannot be resolved. */
  private async resolveConnection(model: string): Promise<ModelConnection> {
    const resolved = await this.registry.resolveModel(model);
    if (!resolved) throw new ModelUnavailableException();
    return this.registry.resolveConnection(resolved.slug);
  }

  /** Writes the hop's child row under its parent run, then its own hops under it, in order (RNX-302's repository). */
  private async writeHop(hop: PeerHop, parentRunId: string, userId: string): Promise<void> {
    const { children, ...row } = hop;
    const written = await this.runs.createChildRun({ ...row, parentRunId, userId });
    for (const child of children) await this.writeHop(child, written.id, userId);
  }
}
