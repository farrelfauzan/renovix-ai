import type { ChatResponse } from "../../providers/provider.interface";

/** A metered model call's response and its callId (the parentCallId of the hops it starts). */
export type MeteredResponse = {
  readonly response: ChatResponse;
  readonly callId: string;
};
