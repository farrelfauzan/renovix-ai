import { Controller, Get, Query, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { UsageService } from "../service/usage.service";

@Controller("usage")
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  @Access({ auth: ["session"] })
  async getUsage(
    @Req() req: any,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("model") model?: string,
    @Query("start_date") startDate?: string,
    @Query("end_date") endDate?: string,
  ) {
    return this.usageService.getUsageByUser(req.user.userId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      model,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }
}
