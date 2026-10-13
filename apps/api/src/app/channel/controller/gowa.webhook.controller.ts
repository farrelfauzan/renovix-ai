import {
  Controller,
  Post,
  Body,
  Req,
  Logger,
  HttpCode,
  BadRequestException,
} from "@nestjs/common";
import { GowaService } from "../service/gowa.service";
import { verifySignature } from "../utils/verify-signature";
import { AgentRunService } from "../../agent/service/agent-run.service";
import { PrismaService } from "../../prisma/prisma.service";
import type { GowaInboundMessage } from "../types/gowa.types";

@Controller("webhooks/gowa")
export class GowaWebhookController {
  private readonly logger = new Logger(GowaWebhookController.name);

  constructor(
    private readonly gowaService: GowaService,
    private readonly runService: AgentRunService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleInbound(@Body() body: unknown, @Req() req: any) {
    const payload = body as GowaInboundMessage;

    // Verify webhook signature
    const signature = req.headers["x-gowa-signature"] as string;
    if (signature) {
      const rawBody = JSON.stringify(body);
      // Get secret from first matching channel config
      const resolved = await this.gowaService.resolveAgent(payload.to);
      if (resolved) {
        const secret = (resolved.channel.config as any)?.webhookSecret;
        if (
          secret &&
          !verifySignature(rawBody, signature, secret)
        ) {
          throw new BadRequestException("Invalid webhook signature");
        }
      }
    }

    // Validate event type
    if (payload.event !== "message.received") {
      return { ok: true, skipped: true };
    }

    // Only handle text messages for now
    if (payload.message.type !== "text" || !payload.message.text?.body) {
      return { ok: true, skipped: true, reason: "non-text message" };
    }

    const messageText = payload.message.text.body.trim();

    // Handle opt-out
    if (messageText.toUpperCase() === "STOP") {
      this.logger.log(`User ${payload.from} opted out`);
      return { ok: true, optedOut: true };
    }

    // Resolve agent by phone number
    const resolved = await this.gowaService.resolveAgent(payload.to);
    if (!resolved) {
      this.logger.warn(`No agent found for number: ${payload.to}`);
      return { ok: true, skipped: true, reason: "no agent configured" };
    }

    const { agent, channel } = resolved;
    const channelConfig = channel.config as any;

    // Create session ID from phone pair
    const sessionId = `wa:${payload.from}:${payload.to}`;

    try {
      // Execute agent (non-streaming for webhook)
      const result = await this.runService.chat(
        agent.userId,
        agent.id,
        messageText,
        sessionId,
      );

      // Send response via GOWA
      await this.gowaService.sendMessage(
        payload.from,
        result.message.content,
        channelConfig,
      );

      return { ok: true, messageId: payload.message.id };
    } catch (error: any) {
      this.logger.error(
        `GOWA webhook processing error: ${error.message}`,
        error.stack,
      );

      // Send error message to user
      try {
        await this.gowaService.sendMessage(
          payload.from,
          "Sorry, I'm having trouble processing your request right now. Please try again later.",
          channelConfig,
        );
      } catch {
        // Silently fail on error notification
      }

      return { ok: false, error: error.message };
    }
  }
}
