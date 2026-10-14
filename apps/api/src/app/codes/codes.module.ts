import { Module } from "@nestjs/common";
import { CodesService } from "./service/codes.service";
import { CodesController } from "./controller/codes.controller";
import { CodesRepository } from "./repository/codes.repository";

@Module({
  controllers: [CodesController],
  providers: [CodesService, CodesRepository],
  exports: [CodesService],
})
export class CodesModule {}
