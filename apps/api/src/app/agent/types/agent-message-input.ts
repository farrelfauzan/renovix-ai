import type { Decimal } from "@prisma/client/runtime/client";

/** RNX-25: one message of an agent run's session as stored: its role and content, and for an answer the run's tokens and cost (none when not given). */
export type AgentMessageInput = {
  readonly runId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly tokens?: number;
  readonly cost?: Decimal;
};
