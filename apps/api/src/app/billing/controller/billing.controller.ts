import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { ConfigService } from "@nestjs/config";
import type Stripe from "stripe";
import { BillingService } from "../service/billing.service";
import { PrismaService } from "../../prisma/prisma.service";

@Controller("billing")
export class BillingController {
  private stripe?: Stripe.Stripe;

  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const stripeKey = this.configService.get<string>("STRIPE_SECRET_KEY");
    if (stripeKey) {
      this.initStripe(stripeKey);
    }
  }

  private async initStripe(key: string) {
    const { default: StripeSDK } = await import("stripe");
    this.stripe = new (StripeSDK as any)(key) as Stripe.Stripe;
  }

  @Get("balance")
  @Access({ auth: ["jwt", "session"] })
  async getBalance(@Req() req: any) {
    const balance = await this.billing.getBalance(req.user.userId);
    return { balance };
  }

  @Get("transactions")
  @Access({ auth: ["jwt", "session"] })
  async getTransactions(
    @Req() req: any,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const take = limit ? parseInt(limit, 10) : 50;
    const skip = offset ? parseInt(offset, 10) : 0;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId: req.user.userId },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prisma.transaction.count({
        where: { userId: req.user.userId },
      }),
    ]);

    return { transactions, total };
  }

  @Post("checkout")
  @Access({ auth: ["jwt", "session"] })
  async createCheckout(@Req() req: any, @Body() body: { amount?: number }) {
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

    const amount = body.amount ?? 5;
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
              name: "Performa AI Credits",
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
