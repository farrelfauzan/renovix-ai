import { Module } from "@nestjs/common";
import { PiiRevealService } from "../admin-auth/service/pii-reveal.service";
import { AdminUsersController } from "./controller/admin-users.controller";
import { AdminUsersService } from "./service/admin-users.service";

/**
 * End users in the back office (RNX-357): /admin/users, API only (no screen yet). PiiRevealService needs only the
 * repositories (RepositoriesModule, global), so it is provided here instead of exporting it from AdminAuthModule.
 */
@Module({
  controllers: [AdminUsersController],
  providers: [AdminUsersService, PiiRevealService],
})
export class AdminUsersModule {}
