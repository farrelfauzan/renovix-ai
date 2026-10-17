import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

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
}
