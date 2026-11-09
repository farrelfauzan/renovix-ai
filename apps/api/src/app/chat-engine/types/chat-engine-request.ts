import type { z } from "zod";
import type { ChatEngineRequestSchema } from "../dto/chat-engine-request.dto";

/** The validated request (input shape: defaults already applied). */
export type ChatEngineRequest = z.output<typeof ChatEngineRequestSchema>;
