import type { MeteredResponse } from "../../agent/types/metered-response";
import type { ChatModelRequest } from "./chat-model-request";

/**
 * RNX-282: an execution's only way to the model: one call metered on the run's reservation (reserved before the first
 * call, a usage entry per call, the budget stop before each call). It rejects with the meter's refusals and the
 * provider's error.
 */
export type ChatModelCall = (request: ChatModelRequest) => Promise<MeteredResponse>;
