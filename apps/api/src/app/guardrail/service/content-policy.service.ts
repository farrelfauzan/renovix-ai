import { Injectable, Logger } from "@nestjs/common";
import { GuardrailResult } from "../dto/guardrail-result.dto";

@Injectable()
export class ContentPolicyService {
  private readonly logger = new Logger(ContentPolicyService.name);

  // Only truly dangerous/illegal content — NOT profanity or angry language
  private readonly illegalPatterns = [
    /how\s+to\s+(make|build|create|construct)\s+(a\s+)?(bomb|explosive|weapon)/i,
    /synthesize\s+(meth|cocaine|heroin|fentanyl)/i,
    /how\s+to\s+(hack|breach|exploit)\s+(into|a)\s+(bank|government|military)/i,
    /generate\s+(child|minor)\s+(porn|sexual|nude)/i,
    /how\s+to\s+(kill|murder|assassinate)\s+(someone|a\s+person)/i,
    /create\s+(malware|ransomware|virus|trojan|keylogger)/i,
    /how\s+to\s+(commit|plan)\s+(a\s+)?(terrorist|mass\s+shooting|attack)/i,
  ];

  // Self-harm — respond with care
  private readonly selfHarmPatterns = [
    /best\s+(way|method)\s+to\s+(kill|end)\s+(myself|your\s*self)/i,
    /how\s+to\s+commit\s+suicide/i,
    /suicide\s+(method|technique|way)/i,
    /painless\s+(way|method)\s+to\s+die/i,
  ];

  validate(input: string): GuardrailResult {
    // Check illegal content
    for (const pattern of this.illegalPatterns) {
      if (pattern.test(input)) {
        this.logger.warn(`Content policy: illegal content request detected`);
        return {
          blocked: true,
          reason: "illegal_content",
          userMessage:
            "I'm sorry, but I'm not able to help with that request. This falls outside what I can assist with. Is there something else I can help you with?",
        };
      }
    }

    // Self-harm — compassionate response
    for (const pattern of this.selfHarmPatterns) {
      if (pattern.test(input)) {
        this.logger.warn(`Content policy: self-harm content detected`);
        return {
          blocked: true,
          reason: "self_harm_content",
          userMessage:
            "I'm concerned about you. I'm not able to provide that kind of information, but I want you to know that help is available. Please reach out to a crisis helpline — in the US you can call or text 988 (Suicide & Crisis Lifeline). You don't have to go through this alone.",
        };
      }
    }

    return { blocked: false };
  }

  validateOutput(output: string): GuardrailResult {
    // Only block if the model somehow generated step-by-step dangerous instructions
    const dangerousOutputPatterns = [
      /step\s*\d+.*(?:detonate|explosive|weapon)/i,
      /ingredients?\s*:.*(?:ammonium\s*nitrate|potassium\s*chlorate)/i,
      /source\s*code.*(?:ransomware|keylogger|exploit)/i,
    ];

    for (const pattern of dangerousOutputPatterns) {
      if (pattern.test(output)) {
        this.logger.warn(`Output guardrail: dangerous content generated`);
        return {
          blocked: true,
          reason: "dangerous_output",
          sanitized:
            "I'm not able to provide that information as it could potentially be used to cause harm. Let me know if there's something else I can help with.",
        };
      }
    }

    return { blocked: false };
  }
}
