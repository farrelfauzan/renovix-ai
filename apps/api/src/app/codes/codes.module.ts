import { Module } from "@nestjs/common";
import { CodesService } from "./codes.service";
import { CombinedAuthGuard } from "../guards/combined-auth.guard";
import { CodesController } from "./codes.controller";

@Module({
  controllers: [CodesController],
  providers: [CodesService, CombinedAuthGuard],
  exports: [CodesService],
})
export class CodesModule {}
