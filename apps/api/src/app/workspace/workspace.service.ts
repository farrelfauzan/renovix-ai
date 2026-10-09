import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import type { UpdateWorkspaceDto } from "./dto/update-workspace.dto";
import { WorkspaceQuotaService } from "./workspace-quota.service";

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: WorkspaceQuotaService,
  ) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private async generateUniqueSlug(
    ownerId: string,
    name: string,
  ): Promise<string> {
    const baseSlug = this.slugify(name);
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.workspace.findFirst({
        where: { ownerId, slug },
      });
      if (!existing) return slug;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    // Verify user has active subscription
    await this.quotaService.requireSubscription(userId);

    const slug = await this.generateUniqueSlug(userId, dto.name);

    const workspace = await this.prisma.workspace.create({
      data: {
        ownerId: userId,
        name: dto.name,
        slug,
        description: dto.description,
        avatar: dto.avatar,
      },
    });

    // Auto-create owner as first member
    await this.prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId,
        role: "owner",
        status: "active",
        joinedAt: new Date(),
      },
    });

    return workspace;
  }

  async list(userId: string) {
    return this.prisma.workspace.findMany({
      where: {
        status: { not: "deleted" },
        members: {
          some: { userId, status: "active" },
        },
      },
      include: {
        _count: { select: { members: { where: { status: "active" } } } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        status: { not: "deleted" },
        members: { some: { userId, status: "active" } },
      },
      include: {
        members: {
          where: { status: "active" },
          include: { user: { select: { id: true, email: true } } },
        },
        _count: { select: { agents: true, memories: true } },
      },
    });

    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    if (workspace.ownerId !== userId) {
      await this.quotaService.enforceCollaboration(workspaceId);
    }

    return workspace;
  }

  async update(workspaceId: string, userId: string, dto: UpdateWorkspaceDto) {
    await this.requireRole(workspaceId, userId, ["owner", "admin"]);

    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.avatar !== undefined && { avatar: dto.avatar }),
      },
    });
  }

  async archive(workspaceId: string, userId: string) {
    await this.requireRole(workspaceId, userId, ["owner"]);

    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: "archived" },
    });
  }

  async requireRole(
    workspaceId: string,
    userId: string,
    allowedRoles: string[],
  ) {
    const member = await this.requireMembership(workspaceId, userId);

    if (!allowedRoles.includes(member.role)) {
      throw new ForbiddenException("Insufficient workspace permissions");
    }

    return member;
  }

  async requireMembership(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });

    if (!member || member.status !== "active") {
      throw new ForbiddenException("Not a member of this workspace");
    }

    // Everyone but the workspace owner (by ownerId) needs a workspace whose
    // owner's plan allows collaboration (RX-113, D64).
    await this.quotaService.enforceCollaboration(workspaceId, userId);

    return member;
  }
}
