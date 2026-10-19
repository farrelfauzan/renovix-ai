import { z } from "zod";

/** A model slug (RX-177, D149 option B): exactly the id the provider expects, e.g. "cc/claude-sonnet-5". */
export const ModelSlugDto = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/:-]{0,127}$/, "slug must match ^[A-Za-z0-9][A-Za-z0-9._/:-]{0,127}$");
