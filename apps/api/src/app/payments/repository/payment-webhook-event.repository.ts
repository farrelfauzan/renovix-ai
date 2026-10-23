import { Injectable } from "@nestjs/common";
import type { PaymentWebhookEvent, Prisma } from "@generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `payment_webhook_events` (RNX-35): one row per verified webhook. Only ever inserted. */
@Injectable()
export class PaymentWebhookEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserts one verified webhook. */
  create(data: Prisma.PaymentWebhookEventUncheckedCreateInput): Promise<PaymentWebhookEvent> {
    return this.prisma.paymentWebhookEvent.create({ data });
  }
}
