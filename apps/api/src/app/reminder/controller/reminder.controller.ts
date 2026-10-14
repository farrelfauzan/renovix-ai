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
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import { ReminderService } from "../service/reminder.service";
import { ReminderStatus } from "@generated/prisma/client.js";
import { z } from "zod";

const CreateReminderSchema = z.object({
  agentId: z.string().uuid(),
  channelId: z.string().uuid(),
  chatRoomId: z.string().uuid(),
  prompt: z.string().min(1).max(2000),
  description: z.string().max(200).optional(),
  cronExpression: z.string().min(1).max(100),
  timezone: z.string().max(50).optional().default("UTC"),
});

const UpdateReminderSchema = z.object({
  prompt: z.string().min(1).max(2000).optional(),
  description: z.string().max(200).optional(),
  cronExpression: z.string().min(1).max(100).optional(),
  timezone: z.string().max(50).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

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
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
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
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
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
