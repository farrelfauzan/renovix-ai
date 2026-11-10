import type { RunScope } from "../../agent/types/run-scope";
import type { OfferedTool } from "./offered-tool";

/** What the context build needs: the runner, the agent's scope for them, the attached knowledge bases, the approved input as the search query and the offered tools. */
export type ChatContextRequest = {
  readonly agentId: string;
  readonly runnerUserId: string;
  readonly scope: RunScope;
  readonly knowledgeBaseIds: readonly string[];
  readonly query: string;
  readonly offeredTools: readonly OfferedTool[];
};
