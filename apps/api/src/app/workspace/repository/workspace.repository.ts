import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import { ensureDefaultWorkspace } from "./ensure-default-workspace";

/**
 * The queries on `workspaces`. Every method takes the transaction as its optional last argument.
 * RX-141 added the lookup the agent memory needs; RX-135 moves the workspace module's own queries here.
 * RNX-125: PrismaService hides deleted workspaces from top-level reads (VISIBLE_ONLY); the writes by id name
 * `deletedAt: null` themselves, and a write on a deleted workspace is a 404. The relation counts and member lists
 * name their own conditions.
 */
@Injectable()
export class WorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The id of this owner's workspace with this slug, if there is one (a deleted workspace's slug is free again). */
  findOwnerWorkspaceBySlug(ownerId: string, slug: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspace.findFirst({
      where: { ownerId, slug },
      select: { id: true },
    });
  }

  /** Creates a workspace of this owner (no member row: the caller adds the owner's). */
  createWorkspace(
    ownerId: string,
    data: Pick<Prisma.WorkspaceUncheckedCreateInput, "name" | "slug" | "description" | "avatar">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).workspace.create({
      data: { ownerId, ...data },
    });
  }

  /** The workspaces (not the default one, RNX-117) this user is an active member of, newest first, with their active member count. */
  listMemberWorkspaces(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspace.findMany({
      where: {
        isDefault: false,
        members: { some: { userId, status: "active" } },
      },
      include: {
        _count: { select: { members: { where: { status: "active" } } } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * The workspace with this id if it is not a default one (RNX-117) and this user is an active member of it, with its
   * active members (and their email) and the number of its live agents and memories.
   */
  findMemberWorkspaceDetail(workspaceId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspace.findFirst({
      where: {
        id: workspaceId,
        isDefault: false,
        members: { some: { userId, status: "active" } },
      },
      include: {
        members: {
          where: { status: "active" },
          include: { user: { select: { id: true, email: true } } },
        },
        _count: {
          select: {
            agents: { where: { deletedAt: null } },
            memories: { where: { deletedAt: null } },
          },
        },
      },
    });
  }

  /** Changes the workspace with this id; 404 when it is deleted. */
  updateWorkspace(
    workspaceId: string,
    data: Pick<Prisma.WorkspaceUncheckedUpdateInput, "name" | "description" | "avatar">,
    tx?: DbTransaction,
  ) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).workspace.update({
        where: { id: workspaceId, deletedAt: null },
        data,
      }),
    );
  }

  /**
   * Soft-deletes the workspace with this id, by this user (RNX-125): the row and its children stay. A default
   * workspace is never deleted. Returns the workspace; 404 when it is already deleted or a default one.
   */
  softDeleteWorkspace(workspaceId: string, deletedById: string, tx?: DbTransaction) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).workspace.update({
        where: { id: workspaceId, deletedAt: null, isDefault: false },
        data: { deletedAt: new Date(), deletedById },
      }),
    );
  }

  /** The id of the workspace of this channel, if it has one. */
  findWorkspaceIdByChannel(channelId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspace.findUnique({
      where: { channelId },
      select: { id: true },
    });
  }

  /** Whether the workspace with this id is its owner's default workspace (RNX-117), if it exists and is not deleted (RNX-125). */
  findDefaultFlag(workspaceId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspace.findUnique({
      where: { id: workspaceId },
      select: { isDefault: true },
    });
  }

  /** The id of the workspace with this id if this user owns it (RNX-203). */
  findOwnedWorkspace(workspaceId: string, ownerId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspace.findFirst({
      where: { id: workspaceId, ownerId },
      select: { id: true },
    });
  }

  /** The status of the workspace with this id ("active" | "archived"), if it exists and is not deleted (RNX-260, RNX-125). */
  findWorkspaceStatus(workspaceId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspace.findUnique({
      where: { id: workspaceId },
      select: { status: true },
    });
  }

  /** This owner's default workspace, created with its owner member row when there is none (RNX-117; race-safe). */
  ensureDefaultWorkspace(ownerId: string, tx?: DbTransaction) {
    return ensureDefaultWorkspace(tx ?? this.prisma, ownerId);
  }

  /** Runs a write on one workspace; Prisma's "no such row" (P2025: deleted, or deleted meanwhile) becomes a 404. */
  private async refuseDeleted<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new NotFoundException("Workspace not found");
      }
      throw err;
    }
  }
}
