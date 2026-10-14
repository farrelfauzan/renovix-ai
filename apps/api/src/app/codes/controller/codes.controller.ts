import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import { CodesService } from "../service/codes.service";
import { RedeemCodeDto } from "../dto/redeem-code.dto";

@Controller("codes")
export class CodesController {
  constructor(private readonly codesService: CodesService) {}

  @Post("redeem")
  @Access({ auth: ["jwt", "session"] })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async redeemCode(@Req() req: any, @Body() body: unknown) {
    const parsed = RedeemCodeDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.codesService.redeemCode(req.user.userId, parsed.data.code);
  }

  @Get("history")
  @Access({ auth: ["jwt", "session"] })
  async getHistory(@Req() req: any) {
    return this.codesService.getHistory(req.user.userId);
  }
}
