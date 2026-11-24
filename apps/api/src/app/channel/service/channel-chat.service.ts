import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ModelUnavailableException } from "../../config/errors/model-unavailable.exception";
import { ChannelService } from "./channel.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { AgentPeerRunService } from "../../agent/service/agent-peer-run.service";
import { AgentRepository } from "../../agent/repository/agent.repository";
import { AgentRunRepository } from "../../agent/repository/agent-run.repository";
import { AgentRunOutputApproval } from "../../agent/adapters/agent-run-output-approval.adapter";
import { createMcpRunSession } from "../../agent/utils/create-mcp-run-session";
import type { CallableAgent } from "../../agent/types/callable-agent";
import type { PeerRunState } from "../../agent/types/peer-run-state";
import { UserRepository } from "../../auth/repository/user.repository";
import { ChatEngineService } from "../../chat-engine/service/chat-engine.service";
import { ChatEngineContextService } from "../../chat-engine/service/chat-engine-context.service";
import { ChatEngineMeterService } from "../../chat-engine/service/chat-engine-meter.service";
import { ChatEngineToolLoop } from "../../chat-engine/service/chat-engine-tool-loop.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { KnowledgeBaseRepository } from "../../knowledge/repository/knowledge-base.repository";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ChannelMessageRepository } from "../repository/channel-message.repository";
import { ChannelChatContext } from "../adapters/channel-chat-context.adapter";
import { ChannelChatExecution } from "../adapters/channel-chat-execution.adapter";
import { ChannelChatPersistence } from "../adapters/channel-chat-persistence.adapter";
import type { ChannelChatEngineParts } from "../types/channel-chat-engine-parts";
import type { ChannelChatOptions } from "../types/channel-chat-options";
import type { ChannelChatResult } from "../types/channel-chat-result";
import type { ChannelChatTurn } from "../types/channel-chat-turn";
import { createChannelChatTurn } from "../utils/create-channel-chat-turn";
import { toChannelChatResult } from "../utils/to-channel-chat-result";

/** The room's earlier messages a channel chat message gets as history (RNX-200: 19, read before the message is saved). */
const ROOM_HISTORY_MESSAGES = 19;

/**
 * RNX-24a: the channel chat (CH) as a thin adapter on the chat engine, the `channel-chat` source. It keeps the
 * channel's own parts: room access (ChannelService.resolveChannelAgent), the run policy and the subscription gate on
 * every message (RNX-119, D192), the room's 19-message history, the room's workspace for MCP tools and metering and the
 * channel id for tools and memory (the request's room), the CH prompt and context, and the room's stored messages.
 * The engine runs the input guardrail, the metered CH tool loop (with call_agent through RNX-121's agent-call step)
 * and the output guardrail.
 */
@Injectable()
export class ChannelChatService {
  /** The chat engine's meter, shared by every channel message (it holds no run's state). */
  private readonly engineMeter: ChatEngineMeterService;
  /** RNX-121b-1: the agent calls (call_agent) of every channel message; each message's calls keep their state in that message. */
  private readonly peerRuns: AgentPeerRunService;

  constructor(
    private readonly registry: ModelRegistryService,
    private readonly channelService: ChannelService,
    private readonly toolService: AgentToolService,
    private readonly memoryService: AgentMemoryService,
    private readonly guardrail: GuardrailService,
    private readonly meter: AgentRunMeterService,
    private readonly links: AgentLinkService,
    private readonly policy: AgentRunPolicyService,
    private readonly users: UserRepository,
    private readonly agents: AgentRepository,
    private readonly runs: AgentRunRepository,
    private readonly channelMessages: ChannelMessageRepository,
    settings: PlatformSettingsService,
    knowledgeBases: KnowledgeBaseRepository,
    workspaceKnowledge: WorkspaceKnowledgeService,
    knowledge: KnowledgeService,
  ) {
    const contexts = new ChatEngineContextService(memoryService, knowledgeBases, workspaceKnowledge, knowledge);
    this.engineMeter = new ChatEngineMeterService(meter, registry);
    this.peerRuns = new AgentPeerRunService(registry, toolService, guardrail, agents, policy, contexts, meter, links, runs, settings);
  }

  /**
   * The refusals of a channel chat message, checked before any work on the chat route (the SSE headers, the classifier
   * call, the message), reads only. RX-178 (review B1): the room access check (403/404), RNX-119: then the run policy
   * on this run (404 "Agent not found" when the caller may no longer run the agent), RNX-260: then 409 in an archived
   * workspace, then the fixed 400
   * (ModelUnavailableException) for a model that cannot be resolved, RNX-119: then 403 without an active subscription
   * (D192). RNX-200: then the run's own pre-checks (the 400 for a model without credit rates, 402 RUN_CAP_EXCEEDED,
   * 402 CREDITS_EXHAUSTED) on a lower bound of the first call: the agent's system prompt, the message and max_tokens
   * (a document format only raises it).
   */
  async assertRunCanStart(userId: string, channelId: string, agentId: string, message: string): Promise<void> {
    const { agent } = await this.channelService.resolveChannelAgent(userId, channelId, agentId);
    await this.policy.assertRunStart(agent, userId);
    const modelEntry = await this.registry.resolveModel(agent.model);
    if (!modelEntry) throw new ModelUnavailableException();
    const connection = await this.registry.resolveConnection(modelEntry.slug);
    await this.policy.assertActiveSubscription(userId);
    await this.meter.assertRunCanStart({
      runnerUserId: userId,
      firstCall: {
        model: modelEntry.slug,
        connection,
        messages: [
          { role: "system", content: agent.systemPrompt || "You are a helpful assistant." },
          { role: "user", content: message },
        ],
        max_tokens: agent.maxTokens ?? 4096,
      },
    });
  }

  /**
   * One channel chat message as one run on the chat engine; RNX-222: the result carries the document its own
   * `create_document` made. RNX-119: the room access, the run policy and the subscription gate (D192) are checked on
   * every message; the caller runs and pays (their own paid wallet), and the reservation is today's (D381: the linked
   * agents count one call each). RNX-335: the caller's saved language is read once per message for the system prompt.
   * RNX-24a: `options.signal` aborts the run (D336: no further model call, no answer stored, what ran settled).
   */
  async chat(userId: string, channelId: string, agentId: string, message: string, options: ChannelChatOptions = {}): Promise<ChannelChatResult> {
    const channelAgent = await this.channelService.resolveChannelAgent(userId, channelId, agentId);
    const { agent } = channelAgent;
    const scope = await this.policy.assertRunStart(agent, userId);
    await this.policy.assertActiveSubscription(userId);
    const callableAgents = await this.links.listCallableAgents(agent, scope);
    const runner = await this.users.findLocale(userId);
    const turn = createChannelChatTurn({ agentId, userId, channelId, channelAgentId: channelAgent.id, message, scope });
    const persistence = new ChannelChatPersistence(this.channelService, this.memoryService, turn);
    const engine = this.createEngine({ turn, agent, callableAgents, persistence, documentFormat: options.documentFormat, signal: options.signal, runnerLocale: runner?.locale });
    const mcpSession = createMcpRunSession();
    const request = await this.toEngineRequest(turn, channelAgent.channel.workspace?.id ?? null, callableAgents, options.documentFormat);
    const runOptions = { signal: options.signal, mcpSession, linkedAgents: callableAgents, onReserved: () => persistence.saveUserMessage() };
    return toChannelChatResult(await engine.collect(request, runOptions), turn, mcpSession);
  }

  /**
   * This message's own chat engine on the shared services, with its own ports: the room's context, the CH execution
   * around the engine's tool loop (with the message's agent calls as its peer port, RNX-121), the output guardrail and
   * the room's persistence. The agent calls' state (RNX-121b-1) lives in this message only.
   */
  private createEngine(parts: ChannelChatEngineParts): ChatEngineService {
    const { turn, agent, callableAgents, persistence, documentFormat, signal, runnerLocale } = parts;
    const state: PeerRunState = { runnerUserId: turn.userId, scope: turn.scope, signal, stack: [agent.id], agentCalls: 0, startedAt: Date.now(), modelCalls: 0, stop: new AbortController() };
    const peer = this.peerRuns.createChannelPeerCall({ agent, callableAgents, state, findParentRunId: () => this.findChannelRunId(turn) });
    const loop = new ChatEngineToolLoop(this.toolService, peer);
    const execution = new ChannelChatExecution(loop, turn, { systemPrompt: agent.systemPrompt, callableAgents, documentFormat, runnerLocale }, state);
    const context = new ChannelChatContext(this.memoryService, turn);
    return new ChatEngineService(this.agents, this.policy, this.guardrail, context, this.engineMeter, execution, new AgentRunOutputApproval(this.guardrail), persistence);
  }

  /** D380: the id of the channel run's one top-level agent_runs row, written at its first agent call (the hops' parent). */
  private findChannelRunId(turn: ChannelChatTurn): Promise<string> {
    turn.channelRunId ??= this.runs.createChannelRun({ agentId: turn.agentId, userId: turn.userId, sessionId: randomUUID() }).then((run) => run.id);
    return turn.channelRunId;
  }

  /**
   * The engine request of the `channel-chat` source: the runner, the agent with the room's history, the room (its
   * channel and workspace), the raw message, and the agent's own tools (MCP tools included) with call_agent when it has
   * callable agents (RNX-118).
   */
  private async toEngineRequest(turn: ChannelChatTurn, workspaceId: string | null, callableAgents: readonly CallableAgent[], documentFormat?: string) {
    const history = await this.listRoomHistory(turn.channelId, turn.agentId);
    return {
      principal: { runnerUserId: turn.userId },
      source: "channel-chat" as const,
      conversation: { agentId: turn.agentId, history, room: { channelId: turn.channelId, workspaceId } },
      input: turn.message,
      options: { documentFormat, offeredTools: [], offersCallAgent: callableAgents.length > 0, offersAgentTools: true },
    };
  }

  /**
   * The agent's 19 newest earlier messages in the room, oldest first. RNX-200: read before the user message is saved
   * (once the run's reservation holds), so they and this message make the 20 the prompt had before.
   */
  private async listRoomHistory(channelId: string, agentId: string) {
    const chatRoom = await this.channelService.getOrCreateChatRoom(channelId);
    const recent = await this.channelMessages.listRecentRoomAgentMessages(chatRoom.id, agentId, ROOM_HISTORY_MESSAGES);
    return recent.reverse().map((m) => ({ role: m.role, content: m.content }));
  }
}
