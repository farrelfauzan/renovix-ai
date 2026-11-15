import type { ChargedResponse } from "./charged-response";
import type { ChatHopTarget } from "./chat-hop-target";
import type { ChatModelRequest } from "./chat-model-request";

/**
 * RNX-282: an execution's only way to the model: one call metered on the run's reservation (reserved before the first
 * call, a usage entry per call, the budget stop before each call). It rejects with the meter's refusals and the
 * provider's error. RNX-25 (D341 D1): with `hop`, the call is a hop's (the called agent, on its own model's connection,
 * with the calling call as parent) on the same reservation; the response carries the call's charge.
 */
export type ChatModelCall = (request: ChatModelRequest, hop?: ChatHopTarget) => Promise<ChargedResponse>;
