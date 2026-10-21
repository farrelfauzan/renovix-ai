import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  ParseUUIDPipe,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import { ReminderService } from "../service/reminder.service";
import { ReminderStatus } from "@generated/prisma/client.js";
import { CreateReminderSchema, UpdateReminderSchema } from "../dto/reminder.dto";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

@Controller("reminders")
@Access({ auth: ["jwt", "session"] })
export class ReminderController {
  constructor(private readonly reminderService: ReminderService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async create(@Body() body: unknown, @Req() req: any) {
    const parsed = CreateReminderSchema.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    return this.reminderService.create(req.user.userId, parsed.data);
  }

  @Get()
  async list(@Req() req: any) {
    return this.reminderService.list(req.user.userId);
  }

  @Get(":id")
  async findById(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.reminderService.findById(req.user.userId, id);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const parsed = UpdateReminderSchema.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }

    const data: any = { ...parsed.data };
    if (data.status) {
      data.status =
        data.status === "ACTIVE"
          ? ReminderStatus.ACTIVE
          : ReminderStatus.PAUSED;
    }

    return this.reminderService.update(req.user.userId, id, data);
  }

  @Delete(":id")
  @HttpCode(204)
  async delete(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.reminderService.softDelete(req.user.userId, id);
  }
}
