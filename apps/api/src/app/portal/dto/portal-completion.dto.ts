import { ChatCompletionRequestSchema } from "../../chat/dto/chat-completion.dto";

/** Body of POST /chat/portal/completions: the chat completion schema with the model optional. */
export const PortalCompletionSchema = ChatCompletionRequestSchema.extend({
  model: ChatCompletionRequestSchema.shape.model.optional(),
});
