import { z } from "zod";
import { ModelSlugDto } from "./model-slug.dto";

/** POST /admin/providers/:id/test (RX-177): the provider's own model id to send one minimal request with. */
export const TestProviderDto = z.strictObject({ slug: ModelSlugDto });
export type TestProviderDto = z.infer<typeof TestProviderDto>;
