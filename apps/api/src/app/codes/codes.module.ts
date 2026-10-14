import { Module } from "@nestjs/common";
import { CodesService } from "./service/codes.service";
import { CombinedAuthGuard } from "../../common/guards/combined-auth.guard";
import { CodesController } from "./controller/codes.controller";
import { CodesRepository } from "./repository/codes.repository";

@Module({
  controllers: [CodesController],
  providers: [CodesService, CodesRepository, CombinedAuthGuard],
  exports: [CodesService],
})
export class CodesModule {}
