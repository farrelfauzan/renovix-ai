import { z } from "zod";

const WEB_SEARCH_PROVIDER = z.enum(["brave-search", "duckduckgo"]);

/** Body of PUT /integrations/web-search/policy (RNX-28): the workspace and the policy fields to change. */
export const UpdateWebSearchPolicySchema = z.object({
  workspaceId: z.string().min(1),
  allowedProviders: z.array(WEB_SEARCH_PROVIDER).optional(),
  preferredProvider: WEB_SEARCH_PROVIDER.optional(),
  maxResults: z.number().optional(),
  dailyLimitPerUser: z.number().optional(),
});
