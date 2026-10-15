import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

/** Validates `value` with `schema`; refuses it with 400 and the validation messages when it does not pass. */
export function parseOrRefuse<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(`${what} refused: ${parsed.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ")}`);
  return parsed.data;
}
