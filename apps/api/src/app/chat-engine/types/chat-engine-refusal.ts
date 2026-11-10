import type { RunDecision } from "../../agent/types/run-decision";

/** The refusal reasons of the run policy. */
export type ChatEngineRefusal = Extract<RunDecision, { allowed: false }>["reason"];
