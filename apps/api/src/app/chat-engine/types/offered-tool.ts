import type { z } from "zod";
import type { OfferedToolSchema } from "../dto/chat-engine-request.dto";

/** A tool the agent offers for this run. */
export type OfferedTool = z.output<typeof OfferedToolSchema>;
