import type { RunScope } from "../../agent/types/run-scope";
import type { OfferedTool } from "./offered-tool";

/** What the model may see besides the input: memory and knowledge the runner is permitted to read, and the offered tools. */
export type ChatEngineContext = {
  readonly scope: RunScope;
  readonly memory: string;
  readonly knowledge: string;
  readonly offeredTools: readonly OfferedTool[];
};
