import { z } from "zod";

/**
 * Body of PUT /integrations/web-search/brave/key and PUT /integrations/web-search/providers/:provider/key (RNX-28).
 * RNX-292: the key is the account's; with `workspaceId` it is also switched on in that workspace.
 */
export const WebSearchKeySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  apiKey: z.string().min(1),
});
