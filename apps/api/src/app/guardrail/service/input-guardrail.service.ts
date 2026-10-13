import { Injectable } from "@nestjs/common";
import { GuardrailResult } from "../dto/guardrail-result.dto";
import { InjectionDetectorService } from "./injection-detector.service";
import { ContentPolicyService } from "./content-policy.service";
import { ViolationTrackerService } from "./violation-tracker.service";

@Injectable()
export class InputGuardrailService {
  constructor(
    private readonly injectionDetector: InjectionDetectorService,
    private readonly contentPolicy: ContentPolicyService,
    private readonly violationTracker: ViolationTrackerService,
  ) {}

  /**
   * Validates user input. Never blocks the user from the platform.
   * Returns a soft decline message that gets returned as the "assistant" response.
   */
  async validate(
    input: string,
    userId: string,
    agentId?: string,
  ): Promise<GuardrailResult> {
    // Prompt injection detection
    const injectionResult = this.injectionDetector.detect(input);
    if (injectionResult.blocked) {
      this.violationTracker
        .logViolation({
          userId,
          agentId,
          type: "prompt_injection",
          severity: "medium",
          input,
        })
        .catch(() => {});
      return injectionResult;
    }

    // Content policy — only truly dangerous/illegal requests
    const contentResult = this.contentPolicy.validate(input);
    if (contentResult.blocked) {
      this.violationTracker
        .logViolation({
          userId,
          agentId,
          type: "content_policy",
          severity: "high",
          input,
        })
        .catch(() => {});
      return contentResult;
    }

    return { blocked: false };
  }
}
