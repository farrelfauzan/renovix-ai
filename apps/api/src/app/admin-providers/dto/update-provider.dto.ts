import { z } from "zod";
import { ProviderApiKeyDto } from "./provider-api-key.dto";
import { ProviderBaseUrlDto } from "./provider-base-url.dto";

const MAX_NAME_LENGTH = 100;

/**
 * PATCH /admin/providers/:id (RX-177). Without `apiKey` the stored key is kept; with one it is rotated.
 * `type` cannot change (an unknown key, refused with 400). `status` may only be set to "inactive" here;
 * activation is POST /admin/providers/:id/activate. A new `baseUrl` needs `apiKey` again in the same request
 * (D197): otherwise the stored key would be sent to the new URL by the next test.
 */
export const UpdateProviderDto = z
  .strictObject({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
    baseUrl: ProviderBaseUrlDto.optional(),
    apiKey: ProviderApiKeyDto.optional(),
    status: z.literal("inactive").optional(),
  })
  .refine((dto) => dto.baseUrl === undefined || dto.apiKey !== undefined, {
    path: ["apiKey"],
    message: "a new baseUrl needs the apiKey again",
  });
export type UpdateProviderDto = z.infer<typeof UpdateProviderDto>;
