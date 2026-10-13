import { Injectable } from "@nestjs/common";
import { InputGuardrailService } from "./input-guardrail.service";
import { OutputGuardrailService } from "./output-guardrail.service";
import { GuardrailResult } from "../dto/guardrail-result.dto";

@Injectable()
export class GuardrailService {
  constructor(
    private readonly inputGuardrail: InputGuardrailService,
    private readonly outputGuardrail: OutputGuardrailService,
  ) {}

  /**
   * Check user input before sending to LLM.
   * If blocked, the userMessage should be returned as the assistant response.
   * The user is NEVER banned — they just get a polite decline for that message.
   */
  async checkInput(
    message: string,
    userId: string,
    agentId?: string,
  ): Promise<GuardrailResult> {
    return this.inputGuardrail.validate(message, userId, agentId);
  }

  /**
   * Check LLM output before returning to user.
   * Masks PII, blocks dangerous content, enforces length.
   */
  async checkOutput(
    output: string,
    userId: string,
    agentId?: string,
  ): Promise<GuardrailResult & { content?: string }> {
    return this.outputGuardrail.validate(output, userId, agentId);
  }
}
