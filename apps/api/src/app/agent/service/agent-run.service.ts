import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ModelUnavailableException } from "../../config/errors/model-unavailable.exception";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { KnowledgeBaseRepository } from "../../knowledge/repository/knowledge-base.repository";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { AgentRepository } from "../repository/agent.repository";
import { AgentRunRepository } from "../repository/agent-run.repository";
import { CreditService } from "../../billing/service/credit.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { assertOwnRun } from "../utils/assert-own-run";
import { createMcpRunSession } from "../utils/create-mcp-run-session";
import { createAgentRunTurn } from "../utils/create-agent-run-turn";
import { toAgentRunReply } from "../utils/to-agent-run-reply";
import { ChatEngineService } from "../../chat-engine/service/chat-engine.service";
import { ChatEngineContextService } from "../../chat-engine/service/chat-engine-context.service";
import { ChatEngineMeterService } from "../../chat-engine/service/chat-engine-meter.service";
import { ChatEngineToolLoop } from "../../chat-engine/service/chat-engine-tool-loop.service";
import { AgentRunExecution } from "../adapters/agent-run-execution.adapter";
import { AgentRunOutputApproval } from "../adapters/agent-run-output-approval.adapter";
import { AgentRunPeerCall } from "../adapters/agent-run-peer-call.adapter";
import { AgentRunPersistence } from "../adapters/agent-run-persistence.adapter";
import type { AgentChatOptions } from "../types/agent-chat-options";
import type { AgentRunEngineParts } from "../types/agent-run-engine-parts";
import type { AgentRunReply } from "../types/agent-run-reply";
import type { AgentRunTurn } from "../types/agent-run-turn";
import type { CallableAgent } from "../types/callable-agent";
import { ONE_MICRO_CREDIT } from "../config/one-micro-credit";

@Injectable()
export class AgentRunService {
  /** RNX-25: the chat engine's context and meter, shared by every agent message (they hold no run's state). */
  private readonly contexts: ChatEngineContextService;
  private readonly engineMeter: ChatEngineMeterService;

  constructor(
    private readonly registry: ModelRegistryService,
    private readonly toolService: AgentToolService,
    private readonly memoryService: AgentMemoryService,
    knowledge: KnowledgeService,
    private readonly guardrail: GuardrailService,
    private readonly agents: AgentRepository,
    private readonly credits: CreditService,
    private readonly meter: AgentRunMeterService,
    knowledgeBases: KnowledgeBaseRepository,
    workspaceKnowledge: WorkspaceKnowledgeService,
    private readonly links: AgentLinkService,
    private readonly policy: AgentRunPolicyService,
    private readonly runs: AgentRunRepository,
  ) {
    this.contexts = new ChatEngineContextService(memoryService, knowledgeBases, workspaceKnowledge, knowledge);
    this.engineMeter = new ChatEngineMeterService(meter, registry);
  }

  /**
   * One agent message as one run on the chat engine (RNX-25), the `agent-run` source. RNX-119: the run policy decides
   * who may run it (404, 409 in an archived workspace) and whether the run is inside the workspace; the run belongs to
   * the runner, who pays. D341 D4: then the subscription gate (403) and the credit pre-check (402 when nothing is available, RX-22b), before
   * the input guardrail and before any knowledge or memory embedding. The engine runs the
   * input guardrail, the context (knowledge RNX-116, memory), the metered tool loop (with call_agent through its peer
   * port, RNX-118) and the output guardrail (RNX-275); this adapter keeps the session row, the history, the AR prompt,
   * the stored messages and the run's cost (Bug B: the sum of its charged model calls). `options.signal` aborts the run
   * (D336: no further model call, no answer stored). RNX-222: the result carries the document its `create_document` made.
   */
  async chat(userId: string, agentId: string, message: string, sessionId?: string, options: AgentChatOptions = {}): Promise<AgentRunReply> {
    const agent = await this.agents.findAgentForRun(agentId);
    if (!agent) throw new NotFoundException("Agent not found");
    const scope = await this.policy.assertRunStart(agent, userId);
    await this.policy.assertActiveSubscription(userId);
    await this.credits.assertAvailable(userId, ONE_MICRO_CREDIT);
    const callableAgents = await this.links.listCallableAgents(agent, scope);
    const turn = createAgentRunTurn({ agentId, userId, sessionId: sessionId || randomUUID(), message, scope });
    const persistence = new AgentRunPersistence(this.runs, this.memoryService, turn);
    const engine = this.createEngine({ turn, agent, callableAgents, persistence, documentFormat: options.documentFormat });
    const mcpSession = createMcpRunSession();
    const request = await this.toEngineRequest(turn, callableAgents, sessionId, options.documentFormat);
    const runOptions = { signal: options.signal, mcpSession, linkedAgents: callableAgents, onReserved: () => persistence.saveUserMessage() };
    return toAgentRunReply(await engine.collect(request, runOptions), turn, mcpSession);
  }

  /**
   * The caller's own runs of the agent (RNX-119). RNX-260 (D259, 78): only "this run is mine", not current run access,
   * so an outsider or a former collaborator still lists their own runs; nobody sees another person's. RNX-124: 404 for
   * a deleted agent (an unknown id still lists none). RNX-302: top-level runs only, never a hop (a child run).
   */
  async listRuns(userId: string, agentId: string) {
    if (await this.agents.findDeletedAgent(agentId)) throw new NotFoundException("Agent not found");
    return this.runs.listRuns(agentId, userId);
  }

  /** One of the caller's own runs, whatever their access now (RNX-260, D259 78); else as assertCallerRun. RNX-124: 404 for a deleted agent's run. */
  async getRun(userId: string, agentId: string, runId: string) {
    const run = await this.runs.findRunWithMessages(runId, agentId);
    return this.assertCallerRun(run, userId, agentId);
  }

  /**
   * Deletes one of the caller's own runs, whatever their access now (RNX-260, D259 78); else as assertCallerRun. RNX-124:
   * 404 for a deleted agent's run. RNX-302: its hops (child runs) go with it (ON DELETE CASCADE).
   */
  async deleteRun(userId: string, agentId: string, runId: string) {
    const run = await this.runs.findRun(runId, agentId);
    await this.assertCallerRun(run, userId, agentId);
    await this.runs.deleteRun(runId);
    return { deleted: true };
  }

  /**
   * The refusals of an agent message, checked before any work on the chat route (the classifier call, the SSE
   * headers, the run and the message), reads only. RX-178 (review B1): 404 for an agent the user cannot run (RNX-119:
   * the run policy), RNX-260: then 409 in an archived workspace, then the fixed 400
   * (ModelUnavailableException) for a model that cannot be resolved. RNX-200: then
   * 403 without an active subscription (D192) and the run's own pre-checks (the 400 for a model without credit rates,
   * 402 RUN_CAP_EXCEEDED, 402 CREDITS_EXHAUSTED) on a lower bound of the first call: the agent's system prompt, the
   * message and max_tokens.
   */
  async assertRunCanStart(userId: string, agentId: string, message: string): Promise<void> {
    const agent = await this.agents.findAgentForRun(agentId);
    if (!agent) throw new NotFoundException("Agent not found");
    await this.policy.assertRunStart(agent, userId);
    const modelConfig = await this.registry.resolveModel(agent.model);
    if (!modelConfig) throw new ModelUnavailableException();
    const connection = await this.registry.resolveConnection(modelConfig.slug);
    await this.policy.assertActiveSubscription(userId);
    await this.meter.assertRunCanStart({
      runnerUserId: userId,
      firstCall: {
        model: agent.model,
        connection,
        messages: [
          { role: "system", content: agent.systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: agent.maxTokens ?? 4096,
      },
    });
  }

  // ─── Private Helpers ───

  /**
   * The run, when it is the caller's: a run (by id) is read or deleted only by the person who ran it. RNX-260 (D259,
   * 78): the caller's own run needs no current access; 404 "Run not found" for no such run, and for another person's
   * run when the caller is not inside the agent's workspace (run policy); 403 for another person's run inside it
   * (RNX-119).
   */
  private async assertCallerRun<T extends { readonly userId: string }>(
    run: T | null,
    userId: string,
    agentId: string,
  ): Promise<T> {
    if (run && run.userId !== userId && !(await this.isInsideAgentWorkspace(userId, agentId))) {
      throw new NotFoundException("Run not found");
    }
    assertOwnRun(run, userId);
    return run;
  }

  /** RNX-119: whether the agent exists and the caller is inside its workspace (run policy). */
  private async isInsideAgentWorkspace(userId: string, agentId: string): Promise<boolean> {
    const agent = await this.agents.findAgentWorkspaceId(agentId);
    return agent !== null && (await this.policy.isInsideWorkspace(agent.workspaceId, userId));
  }

  /**
   * This message's own chat engine on the shared services, with its own ports: the AR execution around the engine's
   * tool loop (with the one-hop agent call as its peer port, D323), the output guardrail and the session's persistence.
   */
  private createEngine(parts: AgentRunEngineParts): ChatEngineService {
    const { turn, agent, callableAgents, persistence, documentFormat } = parts;
    const loop = new ChatEngineToolLoop(this.toolService, new AgentRunPeerCall(this.registry, agent, callableAgents));
    const execution = new AgentRunExecution(loop, turn, { systemPrompt: agent.systemPrompt, callableAgents, documentFormat });
    return new ChatEngineService(this.agents, this.policy, this.guardrail, this.contexts, this.engineMeter, execution, new AgentRunOutputApproval(this.guardrail), persistence);
  }

  /**
   * The engine request of the `agent-run` source: the runner, the session with its history, the raw message, and the
   * agent's own tools (MCP tools included) with call_agent when it has callable agents (RNX-118).
   */
  private async toEngineRequest(turn: AgentRunTurn, callableAgents: readonly CallableAgent[], sessionId?: string, documentFormat?: string) {
    const history = await this.getHistory(turn.agentId, turn.userId, sessionId);
    return {
      principal: { runnerUserId: turn.userId },
      source: "agent-run" as const,
      conversation: { agentId: turn.agentId, sessionId: turn.sessionId, history },
      input: turn.message,
      options: { documentFormat, offeredTools: [], offersCallAgent: callableAgents.length > 0, offersAgentTools: true },
    };
  }

  /**
   * The session's earlier messages, none for a new session. RNX-200: read before the current message is saved, so 19
   * messages are what 20 minus the then-saved current message were before. RNX-119: only the runner's own run.
   */
  private async getHistory(agentId: string, userId: string, sessionId?: string) {
    const run = sessionId ? await this.runs.findActiveRun(agentId, userId, sessionId) : null;
    return run ? this.runs.listHistory(run.id) : [];
  }
}
