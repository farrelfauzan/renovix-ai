import { Injectable, Logger } from "@nestjs/common";
import { GuardrailResult } from "../dto/guardrail-result.dto";

@Injectable()
export class PiiDetectorService {
  private readonly logger = new Logger(PiiDetectorService.name);

  private readonly piiPatterns: Record<
    string,
    { regex: RegExp; mask: (match: string) => string }
  > = {
    creditCard: {
      regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
      mask: (match: string) => {
        const digits = match.replace(/[-\s]/g, "");
        return `****-****-****-${digits.slice(-4)}`;
      },
    },
    email: {
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
      mask: (match: string) => {
        const [local, domain] = match.split("@");
        return `${local[0]}***@***.${domain.split(".").pop()}`;
      },
    },
    phone: {
      regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
      mask: (match: string) => {
        const digits = match.replace(/\D/g, "");
        return `***-***-${digits.slice(-4)}`;
      },
    },
    ssn: {
      regex: /\b\d{3}-\d{2}-\d{4}\b/g,
      mask: (match: string) => `***-**-${match.slice(-4)}`,
    },
  };

  detectAndMask(content: string): { masked: string; detectedTypes: string[] } {
    let masked = content;
    const detectedTypes: string[] = [];

    for (const [type, { regex, mask }] of Object.entries(this.piiPatterns)) {
      // Reset regex lastIndex for global patterns
      regex.lastIndex = 0;
      if (regex.test(content)) {
        detectedTypes.push(type);
        regex.lastIndex = 0;
        masked = masked.replace(regex, mask);
      }
    }

    if (detectedTypes.length > 0) {
      this.logger.warn(
        `PII detected in output: types=${detectedTypes.join(", ")}`,
      );
    }

    return { masked, detectedTypes };
  }

  checkOutput(content: string): GuardrailResult & { sanitized?: string } {
    const { masked, detectedTypes } = this.detectAndMask(content);

    if (detectedTypes.length > 0) {
      return {
        blocked: false, // Don't block, just mask
        reason: "pii_detected",
        sanitized: masked,
      };
    }

    return { blocked: false };
  }
}
