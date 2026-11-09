import { z } from "zod";

/** The ways a run reaches the chat engine (the entrypoints that will call it in later tickets). */
export const CHAT_ENGINE_SOURCES = ["agent-run", "channel-chat", "portal", "reminder"] as const;

/** A tool the run's agent offers: the only tools whose results the engine accepts. */
export const OfferedToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});

/** RNX-281: the typed request of the chat engine: who runs (principal), from where (source), in which conversation, with what input and options. */
export const ChatEngineRequestSchema = z.object({
  principal: z.object({ runnerUserId: z.string().min(1) }),
  source: z.enum(CHAT_ENGINE_SOURCES),
  conversation: z.object({
    agentId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  }),
  input: z.string().min(1),
  options: z
    .object({
      documentFormat: z.enum(["pdf", "docx", "xlsx"]).optional(),
      offeredTools: z.array(OfferedToolSchema).default([]),
    })
    .default({ offeredTools: [] }),
});
