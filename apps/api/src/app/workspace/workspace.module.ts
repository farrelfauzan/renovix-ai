import { Module } from "@nestjs/common";
import { WorkspaceController } from "./controller/workspace.controller";
import { WorkspaceInviteController } from "./controller/workspace-invite.controller";
import { WorkspaceChannelController } from "./controller/workspace-channel.controller";
import { WorkspaceService } from "./service/workspace.service";
import { WorkspaceMemberService } from "./service/workspace-member.service";
import { WorkspaceInviteService } from "./service/workspace-invite.service";
import { WorkspaceQuotaService } from "./service/workspace-quota.service";
import { WorkspaceKnowledgeService } from "./service/workspace-knowledge.service";
import { KnowledgeModule } from "../knowledge/knowledge.module";

@Module({
  imports: [KnowledgeModule],
  controllers: [
    WorkspaceController,
    WorkspaceInviteController,
    WorkspaceChannelController,
  ],
  providers: [
    WorkspaceService,
    WorkspaceMemberService,
    WorkspaceInviteService,
    WorkspaceQuotaService,
    WorkspaceKnowledgeService,
  ],
  exports: [WorkspaceService, WorkspaceQuotaService],
})
export class WorkspaceModule {}
