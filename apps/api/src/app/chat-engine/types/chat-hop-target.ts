import type { ModelConnection } from "../../providers/types/model-connection";

/** RNX-25 (D341 D1): a hop's model call: the called agent (on its usage entry), its own model's connection and the calling model call as its parent. */
export type ChatHopTarget = {
  readonly agentId: string;
  readonly connection: ModelConnection;
  readonly parentCallId: string;
};
