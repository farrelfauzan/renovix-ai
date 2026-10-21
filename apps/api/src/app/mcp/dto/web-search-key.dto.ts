import { z } from "zod";

/** Body of PUT /integrations/web-search/brave/key and PUT /integrations/web-search/providers/:provider/key (RNX-28). */
export const WebSearchKeySchema = z.object({
  workspaceId: z.string().min(1),
  apiKey: z.string().min(1),
});
