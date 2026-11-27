import { Module } from "@nestjs/common";
import { PiiRevealService } from "../admin-auth/service/pii-reveal.service";
import { AdminUserSessionsController } from "./controller/admin-user-sessions.controller";
import { AdminUsersController } from "./controller/admin-users.controller";
import { AdminUsersService } from "./service/admin-users.service";

/**
 * End users in the back office (RNX-357): /admin/users; RNX-100 adds suspend, reinstate, the API key reset and the
 * user's sessions (/admin/users/:id/sessions). PiiRevealService needs only the repositories (RepositoriesModule,
 * global), so it is provided here instead of exporting it from AdminAuthModule.
 */
@Module({
  controllers: [AdminUsersController, AdminUserSessionsController],
  providers: [AdminUsersService, PiiRevealService],
})
export class AdminUsersModule {}
