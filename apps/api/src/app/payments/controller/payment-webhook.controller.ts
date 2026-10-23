import { Controller, HttpCode, Post, Req, UnauthorizedException, type RawBodyRequest } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Access } from "../../../common/decorators/access.decorator";
import { PaymentWebhookService } from "../service/payment-webhook.service";

/**
 * POST /webhooks/payments (RNX-35): the payment provider's callback. Public; the provider checks the signature over the
 * raw body in the handler before anything is read or recorded. 200 once verified, whatever it reported: a webhook never
 * grants, it only starts a status check.
 */
@Controller("webhooks/payments")
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post()
  @HttpCode(200)
  @Access({ public: true, reason: "the payment provider calls it without a login; the signature is checked in the handler (RNX-35)" })
  async receive(@Req() req: RawBodyRequest<FastifyRequest>): Promise<{ received: true }> {
    if (!req.rawBody) throw new UnauthorizedException("Invalid webhook signature");
    await this.webhooks.receive({ rawBody: req.rawBody, headers: req.headers });
    return { received: true };
  }
}
