import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `workspace_members` (RX-116). Every method takes the transaction as its optional last argument. */
@Injectable()
export class WorkspaceMemberRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** This user's member row in this workspace, whatever its status, if there is one. */
  findMembership(workspaceId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
  }
}
