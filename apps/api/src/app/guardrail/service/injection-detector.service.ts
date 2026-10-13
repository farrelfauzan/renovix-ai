import { Injectable, Logger } from "@nestjs/common";
import { GuardrailResult } from "../dto/guardrail-result.dto";

@Injectable()
export class InjectionDetectorService {
  private readonly logger = new Logger(InjectionDetectorService.name);

  private readonly injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts)/i,
    /you\s+are\s+now\s+(a|an|the)/i,
    /\[?\s*system\s*\]?\s*:/i,
    /do\s+not\s+follow\s+(your|the)\s+(rules|instructions)/i,
    /pretend\s+(you\s+are|to\s+be)/i,
    /override\s+(your|system)\s+(prompt|instructions)/i,
    /<\|?(system|im_start|endoftext)\|?>/i,
    /forget\s+(all|your|everything|previous)\s+(instructions|rules|training)/i,
    /disregard\s+(all|your|previous)\s+(instructions|rules)/i,
    /new\s+instructions?\s*:/i,
    /\bact\s+as\s+(if|though)\s+you\s+(have\s+no|don'?t\s+have)\s+restrictions/i,
    /reveal\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
    /what\s+(is|are)\s+your\s+(system\s+)?(prompt|instructions|rules)/i,
    /repeat\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
    /output\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
  ];

  detect(input: string): GuardrailResult {
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(input)) {
        this.logger.warn(
          `Prompt injection detected: pattern=${pattern.source}`,
        );
        return {
          blocked: true,
          reason: "prompt_injection_detected",
          userMessage:
            "I'm not able to process that request. It looks like it's trying to modify how I operate. Please ask me something else and I'll be happy to help!",
        };
      }
    }

    // Check for delimiter manipulation (excessive special characters that might break prompt formatting)
    const delimiterCount = (input.match(/[<>\[\]{}|\\]{3,}/g) || []).length;
    if (delimiterCount > 5) {
      this.logger.warn("Possible delimiter injection detected");
      return {
        blocked: true,
        reason: "delimiter_manipulation",
        userMessage:
          "I'm not able to process that request due to its formatting. Could you rephrase what you'd like help with?",
      };
    }

    return { blocked: false };
  }
}
