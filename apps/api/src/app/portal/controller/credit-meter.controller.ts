import { Controller, Get, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import type { SignedInUserRequest } from "../../auth/types/signed-in-user-request";
import { CreditMeterService } from "../service/credit-meter.service";
import type { CreditMeter } from "../types/credit-meter";

/**
 * GET /api/v1/chat/portal/credit-meter (RNX-30-A): the signed-in user's own credit meter. The user comes from the
 * Better Auth session only (`session`, not `portal`: an anonymous portal visitor has no meter); the route reads no
 * parameter, so no other user's or company's meter can be asked for.
 */
@Controller("chat/portal")
export class CreditMeterController {
  constructor(private readonly creditMeter: CreditMeterService) {}

  /** Paid and weekly_free credits left, the paid run-out projection, the warning level, the floor flag and the red-state reminders. */
  @Get("credit-meter")
  @Access({ auth: ["session"] })
  getMine(@Req() req: SignedInUserRequest): Promise<CreditMeter> {
    return this.creditMeter.getForUser(req.user.userId);
  }
}
