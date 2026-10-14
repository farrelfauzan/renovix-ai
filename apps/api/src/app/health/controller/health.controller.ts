import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service";
import { Access } from "../../../common/decorators/access.decorator";

@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Access({ public: true, reason: "health check for uptime probes" })
  async check() {
    try {
      await this.prisma.$executeRaw(Prisma.sql`SELECT 1`);
      return { status: "ok", database: "connected" };
    } catch {
      return { status: "degraded", database: "disconnected" };
    }
  }
}
