import { Module } from "@nestjs/common";
import { CodesService } from "./service/codes.service";
import { CodesController } from "./controller/codes.controller";

@Module({
  controllers: [CodesController],
  providers: [CodesService],
  exports: [CodesService],
})
export class CodesModule {}
