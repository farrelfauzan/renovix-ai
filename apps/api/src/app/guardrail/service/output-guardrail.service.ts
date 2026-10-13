import { Injectable, Logger } from "@nestjs/common";
import { GuardrailResult } from "../dto/guardrail-result.dto";
import { ContentPolicyService } from "./content-policy.service";
import { PiiDetectorService } from "./pii-detector.service";
import { ViolationTrackerService } from "./violation-tracker.service";

const MAX_RESPONSE_LENGTH = 16000;

@Injectable()
export class OutputGuardrailService {
  private readonly logger = new Logger(OutputGuardrailService.name);

  constructor(
    private readonly contentPolicy: ContentPolicyService,
    private readonly piiDetector: PiiDetectorService,
    private readonly violationTracker: ViolationTrackerService,
  ) {}

  /**
   * Validates LLM output. Replaces dangerous content with a safe decline.
   * Masks PII. Enforces max response length.
   */
  async validate(
    output: string,
    userId: string,
    agentId?: string,
  ): Promise<GuardrailResult & { content?: string }> {
    let content = output;

    // Content policy check — only blocks truly dangerous generated content
    const contentResult = this.contentPolicy.validateOutput(content);
    if (contentResult.blocked) {
      this.violationTracker
        .logViolation({
          userId,
          agentId,
          type: "dangerous_output",
          severity: "high",
          output: content.slice(0, 500),
        })
        .catch(() => {});
      return {
        blocked: true,
        reason: contentResult.reason,
        sanitized: contentResult.sanitized,
        userMessage: contentResult.sanitized,
      };
    }

    // PII detection & masking (always on — protects users)
    const piiResult = this.piiDetector.checkOutput(content);
    if (piiResult.sanitized) {
      this.violationTracker
        .logViolation({
          userId,
          agentId,
          type: "pii_leak",
          severity: "low",
          output: content.slice(0, 500),
        })
        .catch(() => {});
      content = piiResult.sanitized;
    }

    // Response length enforcement
    if (content.length > MAX_RESPONSE_LENGTH) {
      content =
        content.slice(0, MAX_RESPONSE_LENGTH) + "\n\n[Response truncated]";
    }

    return { blocked: false, content };
  }
}
