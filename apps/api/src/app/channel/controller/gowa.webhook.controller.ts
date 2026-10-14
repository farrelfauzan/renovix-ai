import {
  Controller,
  Post,
  Body,
  Req,
  Logger,
  HttpCode,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { GowaService } from "../service/gowa.service";
import { verifySignature } from "../utils/verify-signature";
import { AgentRunService } from "../../agent/service/agent-run.service";
import type { GowaInboundMessage } from "../types/gowa.types";
import { Access } from "../../../common/decorators/access.decorator";

/** GOWA sends `X-Hub-Signature-256: sha256=<hex>` (note R-8, GOWA v9.6.0). */
const SIGNATURE_PREFIX = "sha256=";

@Controller("webhooks/gowa")
export class GowaWebhookController {
  private readonly logger = new Logger(GowaWebhookController.name);

  constructor(
    private readonly gowaService: GowaService,
    private readonly runService: AgentRunService,
  ) {}

  @Post()
  @Access({
    public: true,
    reason:
      "GOWA calls it without a login; the handler checks X-Hub-Signature-256 over the raw body with the channel's webhookSecret first (RX-115)",
  })
  @HttpCode(200)
  async handleInbound(
    @Body() body: unknown,
    @Req() req: RawBodyRequest<FastifyRequest>,
  ) {
    const payload = body as GowaInboundMessage;

    // Verify the webhook signature before anything else (RX-115): "sha256=" + HMAC-SHA256 of the
    // raw body with the webhookSecret of a channel for payload.to. Several tenants can save the same
    // number, so the call belongs to the channel whose secret verifies it. Every refusal is the same 401.
    const signature = req.headers["x-hub-signature-256"];
    const hex =
      typeof signature === "string" && signature.startsWith(SIGNATURE_PREFIX)
        ? signature.slice(SIGNATURE_PREFIX.length)
        : undefined;
    const rawBody = req.rawBody;
    const candidates =
      hex && rawBody ? await this.gowaService.findWhatsappChannels(payload?.to) : [];
    const resolved = candidates.find(({ channel }) =>
      verifySignature(rawBody!, hex!, (channel.config as any)?.webhookSecret),
    );
    if (!resolved) {
      throw new UnauthorizedException("Invalid webhook signature");
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
