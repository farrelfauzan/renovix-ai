import { z } from "zod";

const JsonSchemaResponseFormatSchema = z.object({
  type: z.literal("json_schema"),
  json_schema: z.object({
    name: z.string().min(1),
    schema: z.record(z.unknown()),
  }),
});

const RegexResponseFormatSchema = z.object({
  type: z.literal("regex"),
  pattern: z.string().min(1),
});

const JsonObjectResponseFormatSchema = z.object({
  type: z.literal("json_object"),
});

const ResponseFormatSchema = z.discriminatedUnion("type", [
  JsonSchemaResponseFormatSchema,
  RegexResponseFormatSchema,
  JsonObjectResponseFormatSchema,
]);

export const ChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(100_000),
      }),
    )
    .min(1)
    .max(100),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(128000).optional(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
  conversation_id: z.string().uuid().optional(),
  store: z.boolean().default(false),
  response_format: ResponseFormatSchema.optional(),
  output_format: z.enum(["pdf", "docx", "xlsx"]).optional(),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

/**
 * The body of the API-key route POST /chat/completions (RNX-196): the chat completion with OpenAI's `stream` and
 * `stream_options.include_usage`. A document (`output_format`) is not generated while streaming, so the two are refused
 * together.
 */
export const ApiChatCompletionRequestSchema = ChatCompletionRequestSchema.extend({
  stream: z.boolean().default(false),
  stream_options: z.object({ include_usage: z.boolean().default(false) }).optional(),
}).refine((body) => !(body.stream && body.output_format), {
  message: "output_format is not supported with stream",
  path: ["output_format"],
});

export type ApiChatCompletionRequest = z.infer<typeof ApiChatCompletionRequestSchema>;
