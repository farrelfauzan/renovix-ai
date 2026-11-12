import { envSchema } from "../config/env.schema";
import type { AppEnv } from "../types/app-env";
import { assertRequiredSecrets } from "./assert-required-secrets";

/**
 * RNX-43: validates the environment once, first thing in bootstrap, before anything reads a secret. Throws one
 * error that names every variable refused (the secrets first) and never a value; returns the typed values.
 */
export function parseEnv(env: NodeJS.ProcessEnv): AppEnv {
  const problems: string[] = [];
  try {
    assertRequiredSecrets(env);
  } catch (err) {
    problems.push(err instanceof Error ? err.message : "a required secret is invalid");
  }
  const result = envSchema.safeParse(env);
  if (!result.success) problems.push(...result.error.issues.map((issue) => issue.message));
  if (problems.length) throw new Error(`Invalid environment: ${problems.join("; ")}`);
  return result.data as AppEnv;
}
