import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import { ensureDefaultWorkspace } from "./ensure-default-workspace";

/**
 * The queries on `workspaces`. Every method takes the transaction as its optional last argument.
 * RX-141 added the lookup the agent memory needs; RX-135 moves the workspace module's own queries here.
 */
@Injectable()
export class WorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The id of the workspace of this channel, if it has one. */
  findWorkspaceIdByChannel(channelId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspace.findUnique({
      where: { channelId },
      select: { id: true },
    });
  }

  /** Whether the workspace with this id is its owner's default workspace (RNX-117), if the workspace exists. */
  findDefaultFlag(workspaceId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspace.findUnique({
      where: { id: workspaceId },
      select: { isDefault: true },
    });
  }

  /** This owner's default workspace, created with its owner member row when there is none (RNX-117; race-safe). */
  ensureDefaultWorkspace(ownerId: string, tx?: DbTransaction) {
    return ensureDefaultWorkspace(tx ?? this.prisma, ownerId);
  }
}
