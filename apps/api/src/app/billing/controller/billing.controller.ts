import {
  Controller,
  Post,
  Body,
  Req,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { ConfigService } from "@nestjs/config";
import type Stripe from "stripe";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { CreateCheckoutSchema } from "../dto/create-checkout.dto";

@Controller("billing")
export class BillingController {
  private stripe?: Stripe.Stripe;

  constructor(private readonly configService: ConfigService) {
    const stripeKey = this.configService.get<string>("STRIPE_SECRET_KEY");
    if (stripeKey) {
      this.initStripe(stripeKey);
    }
  }

  private async initStripe(key: string) {
    const { default: StripeSDK } = await import("stripe");
    this.stripe = new (StripeSDK as any)(key) as Stripe.Stripe;
  }

  @Post("checkout")
  @Access({ auth: ["jwt", "session"] })
  async createCheckout(@Req() req: any, @Body() body: unknown) {
    if (
      !this.configService.get<string>("STRIPE_ENABLED") ||
      this.configService.get<string>("STRIPE_ENABLED") === "false"
    ) {
      throw new ServiceUnavailableException(
        "Payment via Stripe is temporarily disabled. Please use an invitation code to top up credits.",
      );
    }

    if (!this.stripe) {
      throw new BadRequestException("Payment system not configured");
    }

    const parsed = CreateCheckoutSchema.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const amount = parsed.data.amount ?? 5;
    if (amount < 5) {
      throw new BadRequestException("Minimum top-up amount is $5");
    }

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Renovix AI Credits",
              description: `$${amount} credit top-up`,
            },
            unit_amount: amount * 100,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: req.user.userId,
      },
      success_url: `${this.configService.get<string>("DASHBOARD_URL") || "http://localhost:3000"}/billing?success=true`,
      cancel_url: `${this.configService.get<string>("DASHBOARD_URL") || "http://localhost:3000"}/billing?canceled=true`,
    });

    return { url: session.url };
  }
}
