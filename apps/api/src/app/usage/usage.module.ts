import { Module } from "@nestjs/common";
import { UsageService } from "./service/usage.service";
import { UsageController } from "./controller/usage.controller";

@Module({
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
