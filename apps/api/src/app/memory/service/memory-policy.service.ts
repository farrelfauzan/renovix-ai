import { Injectable } from "@nestjs/common";
import { checkSensitivity } from "../utils/check-sensitivity";
import { checkPromptInjection } from "../utils/check-prompt-injection";
import { checkRelevance } from "../utils/check-relevance";

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class MemoryPolicyService {
  validateMemoryCandidate(content: string): PolicyCheckResult {
    const sensitivityCheck = checkSensitivity(content);
    if (!sensitivityCheck.allowed) return sensitivityCheck;

    const injectionCheck = checkPromptInjection(content);
    if (!injectionCheck.allowed) return injectionCheck;

    const relevanceCheck = checkRelevance(content);
    if (!relevanceCheck.allowed) return relevanceCheck;

    return { allowed: true };
  }
}
