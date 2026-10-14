import { z } from "zod";

export const AgentChatSchema = z.object({
  message: z.string().min(1).max(10000),
  sessionId: z.string().uuid().optional(),
  output_format: z.enum(["pdf", "docx", "xlsx"]).optional(),
});

export type AgentChatDto = z.infer<typeof AgentChatSchema>;

export const AttachToolSchema = z.object({
  toolType: z.enum([
    "web_search",
    "calculator",
    "api_call",
    "knowledge_retrieval",
    "memory_store",
    "delegate_to_subagent",
    "create_reminder",
    "create_document",
  ]),
  config: z.record(z.any()).optional(),
  enabled: z.boolean().optional().default(true),
});

export type AttachToolDto = z.infer<typeof AttachToolSchema>;

export const AttachIntegrationSchema = z.object({
  provider: z.enum([
    "jira",
    "plane",
    "google_calendar",
    "outlook",
    "notion",
    "slack",
    "github",
  ]),
  config: z.record(z.any()),
  scopes: z.array(z.string()).min(1),
});

export type AttachIntegrationDto = z.infer<typeof AttachIntegrationSchema>;

export const WHATSAPP_WEBHOOK_SECRET_REQUIRED =
  "webhookSecret is required for a whatsapp (GOWA) channel";

/** RX-115: the GOWA webhook refuses every call for a whatsapp channel without a webhookSecret. */
export const WhatsappChannelConfigSchema = z.object({
  webhookSecret: z.string().min(1),
});

export const DeployChannelSchema = z
  .object({
    channelType: z.enum(["web", "whatsapp", "api"]),
    config: z.record(z.any()).optional(),
  })
  .refine(
    (data) =>
      data.channelType !== "whatsapp" ||
      WhatsappChannelConfigSchema.safeParse(data.config).success,
    { path: ["config", "webhookSecret"], error: WHATSAPP_WEBHOOK_SECRET_REQUIRED },
  );

export type DeployChannelDto = z.infer<typeof DeployChannelSchema>;

export const AttachKnowledgeBaseSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
});

export type AttachKnowledgeBaseDto = z.infer<typeof AttachKnowledgeBaseSchema>;
