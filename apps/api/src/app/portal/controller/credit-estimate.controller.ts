import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import type { SignedInUserRequest } from "../../auth/types/signed-in-user-request";
import { CreditEstimateSchema } from "../dto/credit-estimate.dto";
import { CreditEstimateService } from "../service/credit-estimate.service";
import type { CreditEstimate } from "../types/credit-estimate";

/**
 * POST /api/v1/chat/portal/credit-estimate (RNX-331): "up to N credits" for a message before it is sent. The user
 * comes from the Better Auth session only (`session`); a user or account id in the body is not part of the schema and
 * is ignored. Answers only for a model the user's packages allow (the portal send's tier check).
 */
@Controller("chat/portal")
export class CreditEstimateController {
  constructor(private readonly creditEstimate: CreditEstimateService) {}

  /** The most credits the reservation of this message on this model would hold; holds and writes nothing. */
  @Post("credit-estimate")
  @Access({ auth: ["session"] })
  @HttpCode(200)
  estimate(@Body() body: unknown, @Req() req: SignedInUserRequest): Promise<CreditEstimate> {
    const parsed = CreditEstimateSchema.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    return this.creditEstimate.estimate({ ...parsed.data, userId: req.user.userId });
  }
}
