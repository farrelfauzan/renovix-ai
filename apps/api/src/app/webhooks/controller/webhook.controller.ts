import {
  Controller,
  Post,
  Get,
  Req,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Stripe from "stripe";
import { Decimal } from "@prisma/client/runtime/client";
import { BillingService } from "../../billing/service/billing.service";
import { Access } from "../../../common/decorators/access.decorator";

@Controller("webhooks")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private stripe?: Stripe.Stripe;
  private webhookSecret?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly billing: BillingService,
  ) {
    const stripeKey = this.configService.get<string>("STRIPE_SECRET_KEY");
    if (stripeKey) {
      this.webhookSecret = this.configService.get<string>(
        "STRIPE_WEBHOOK_SECRET",
      );
      this.initStripe(stripeKey);
    }
  }

  private async initStripe(key: string) {
    const { default: StripeSDK } = await import("stripe");
    this.stripe = new (StripeSDK as any)(key) as Stripe.Stripe;
  }

  @Get("stripe")
  @Access({ public: true, reason: "tells whether Stripe is configured, no data behind it" })
  healthCheck() {
    return { status: "ok", configured: !!this.stripe };
  }

  @Post("stripe")
  @Access({ public: true, reason: "Stripe calls it without a login; the signature is checked in the handler" })
  async handleStripeWebhook(@Req() req: any) {
    if (
      !this.configService.get<string>("STRIPE_ENABLED") ||
      this.configService.get<string>("STRIPE_ENABLED") === "false"
    ) {
      return { received: false, reason: "Stripe is disabled" };
    }

    this.logger.log("Stripe webhook hit");

    if (!this.stripe || !this.webhookSecret) {
      throw new BadRequestException("Stripe not configured");
    }

    const signature = req.headers["stripe-signature"] as string;
    if (!signature) {
      throw new BadRequestException("Missing stripe-signature header");
    }

    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody) {
      this.logger.error("rawBody is missing from request");
      throw new BadRequestException("Raw body not available");
    }

    let event: any;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
      this.logger.log(`Verified Stripe event: ${event.type}`);
    } catch (err: any) {
      this.logger.error(
        `Webhook signature verification failed: ${err.message}`,
      );
      throw new BadRequestException("Invalid webhook signature");
    }

    switch (event.type) {
      case "checkout.session.completed": {
        await this.handleCheckoutComplete(event.data.object);
        break;
      }
      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  private async handleCheckoutComplete(session: any) {
    const userId = session.metadata?.userId;
    if (!userId) {
      this.logger.error("Checkout session missing userId in metadata");
      return;
    }

    const amountInDollars = (session.amount_total ?? 0) / 100;

    // RX-22: one top_up ledger entry; a session already processed writes nothing (its reference is the idempotency key).
    await this.billing.addBalance(
      userId,
      new Decimal(amountInDollars),
      session.id,
    );

    this.logger.log(
      `Added $${amountInDollars} to user ${userId} (session: ${session.id})`,
    );
  }
}
