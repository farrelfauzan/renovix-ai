import { z } from "zod";
import { PROVIDER_TYPE_NAMES } from "../config/provider-type-names";
import { ProviderApiKeyDto } from "./provider-api-key.dto";
import { ProviderBaseUrlDto } from "./provider-base-url.dto";

const MAX_NAME_LENGTH = 100;

/** POST /admin/providers (RX-177): every field is required; the provider is created inactive. */
export const CreateProviderDto = z.strictObject({
  type: z.enum(Object.values(PROVIDER_TYPE_NAMES)),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  baseUrl: ProviderBaseUrlDto,
  apiKey: ProviderApiKeyDto,
});
export type CreateProviderDto = z.infer<typeof CreateProviderDto>;
