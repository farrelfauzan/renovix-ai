import type { GuardrailResult } from "../../guardrail/dto/guardrail-result.dto";
import type { InputApproval } from "../types/input-approval";

/** Approved input: the guardrail's sanitized text when it gave one (a transformation), else the input unchanged; a blocked input is rejected with its user message (or the default decline). */
export function approveInput(raw: string, verdict: GuardrailResult, defaultDecline: string): InputApproval {
  if (verdict.blocked) return { rejected: true, message: verdict.userMessage || defaultDecline };
  return { rejected: false, input: verdict.sanitized ?? raw };
}
