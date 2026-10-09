import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { UpdateMemberDto } from "./dto/update-member.dto";
import { WorkspaceQuotaService } from "./workspace-quota.service";

@Injectable()
export class WorkspaceMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: WorkspaceQuotaService,
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
      await this.quotaService.enforceCollaboration(workspaceId);
    }

    return this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
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

    return this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { status: "removed" },
    });
  }
}
