import type { AgentRepository } from "../../agent/repository/agent.repository";

/** The agent as the run entries load it (AgentRepository.findAgentForRun): its workspace, status, publication and attached knowledge bases. */
export type ChatEngineAgent = NonNullable<Awaited<ReturnType<AgentRepository["findAgentForRun"]>>>;
