import { Controller, Get, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import type { SignedInUserRequest } from "../../auth/types/signed-in-user-request";
import { MyEntitlementsService } from "../service/my-entitlements.service";
import type { MyEntitlements } from "../types/my-entitlements";

/** GET /api/v1/entitlements/me (RNX-76 B3b, Q4): the signed-in user's package limits for the UI limit pills. */
@Controller("entitlements")
export class EntitlementsController {
  constructor(private readonly myEntitlements: MyEntitlementsService) {}

  /** The caller's package name, agent use and limit, tool limit, API access, channels, tiers, collaboration and next package. */
  @Get("me")
  @Access({ auth: ["session"] })
  getMine(@Req() req: SignedInUserRequest): Promise<MyEntitlements> {
    return this.myEntitlements.getForUser(req.user.userId);
  }
}
