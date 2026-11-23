import { ChatCompletionRequestSchema } from "../../chat/dto/chat-completion.dto";

/** Body of POST /chat/portal/credit-estimate (RNX-331): the model and the messages a send would carry, nothing else. */
export const CreditEstimateSchema = ChatCompletionRequestSchema.pick({ model: true, messages: true });
