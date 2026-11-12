import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { UpdateMemberDto } from "../dto/update-member.dto";
import { WorkspaceQuotaService } from "./workspace-quota.service";
import { WorkspaceMcpConnectionRepository } from "../../mcp/repository/workspace-mcp-connection.repository";

@Injectable()
export class WorkspaceMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: WorkspaceQuotaService,
    private readonly mcpConnections: WorkspaceMcpConnectionRepository,
  ) {}

  async listMembers(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId, status: "active" },
      include: {
        user: { select: { id: true, email: true } },
      },
      orderBy: { joinedAt: "asc" },
    });
  }

  async updateMember(
    workspaceId: string,
    memberId: string,
    dto: UpdateMemberDto,
  ) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });

    if (!member) {
      throw new NotFoundException("Member not found");
    }

    if (member.role === "owner") {
      throw new BadRequestException("Cannot modify the workspace owner");
    }

    // Reactivating a removed member adds a member
    if (dto.status === "active" && member.status !== "active") {
      await this.quotaService.requireOwnerCollaboration(workspaceId);
    }

    // RNX-292: a member set to removed loses their MCP switches in this workspace, in the same transaction.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workspaceMember.update({
        where: { id: memberId },
        data: {
          ...(dto.role !== undefined && { role: dto.role }),
          ...(dto.status !== undefined && { status: dto.status }),
        },
      });
      if (updated.status !== "active") await this.mcpConnections.deleteMemberConnections(workspaceId, member.userId, tx);
      return updated;
    });
  }

  async removeMember(workspaceId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });

    if (!member) {
      throw new NotFoundException("Member not found");
    }

    if (member.role === "owner") {
      throw new BadRequestException("Cannot remove the workspace owner");
    }

    // RNX-292: the removed member's MCP switches in this workspace go in the same transaction.
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.workspaceMember.update({
        where: { id: memberId },
        data: { status: "removed" },
      });
      await this.mcpConnections.deleteMemberConnections(workspaceId, member.userId, tx);
      return removed;
    });
  }
}
