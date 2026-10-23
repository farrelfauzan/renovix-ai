import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { CheckoutBodyDto } from "../dto/checkout-body.dto";
import { CheckoutService } from "../service/checkout.service";
import type { BuyerOrderView } from "../types/buyer-order-view";
import type { SignedInRequest } from "../types/signed-in-request";

/**
 * The buyer's payment routes (RNX-35): start a checkout, and read one's own order. Signed-in product users only
 * (`session`). No price comes from the caller: the order is priced from the catalog.
 */
@Controller("payments")
export class PaymentsController {
  constructor(private readonly checkout: CheckoutService) {}

  /** Starts a checkout: 201 with the pending order and its payment code; 503 while payments are paused or a setting or the rate is missing. */
  @Post("checkout")
  @Access({ auth: ["session"] })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async startCheckout(@Body() body: unknown, @Req() req: SignedInRequest): Promise<BuyerOrderView> {
    const parsed = CheckoutBodyDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    return this.checkout.startCheckout(req.user.userId, parsed.data);
  }

  /** The caller's own order; 404 for another user's. */
  @Get("orders/:id")
  @Access({ auth: ["session"] })
  getOrder(@Param("id") id: string, @Req() req: SignedInRequest): Promise<BuyerOrderView> {
    return this.checkout.getOrder(req.user.userId, id);
  }
}
