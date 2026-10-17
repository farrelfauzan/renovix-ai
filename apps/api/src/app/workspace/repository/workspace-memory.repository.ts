import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `workspace_memories` (RX-141). Every method takes the transaction as its optional last
 * argument. `updateWorkspaceMemory` writes by id and takes no workspace: the service found the row with
 * `findActiveWorkspaceMemoryContaining` first, as before.
 */
@Injectable()
export class WorkspaceMemoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The active memories of this workspace, the most confident first, `take` of them. */
  listActiveWorkspaceMemories(workspaceId: string, take: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspaceMemory.findMany({
      where: { workspaceId, status: "active" },
      orderBy: { confidence: "desc" },
      take,
    });
  }

  /** The active memory of this workspace whose text contains this snippet, if there is one. */
  findActiveWorkspaceMemoryContaining(workspaceId: string, snippet: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).workspaceMemory.findFirst({
      where: { workspaceId, content: { contains: snippet }, status: "active" },
    });
  }

  /** Changes the workspace memory with this id. */
  updateWorkspaceMemory(
    id: string,
    data: Prisma.WorkspaceMemoryUncheckedUpdateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).workspaceMemory.update({
      where: { id },
      data,
    });
  }

  /** Stores a memory of this workspace. */
  createWorkspaceMemory(
    workspaceId: string,
    data: Omit<Prisma.WorkspaceMemoryUncheckedCreateInput, "workspaceId">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).workspaceMemory.create({
      data: { workspaceId, ...data },
    });
  }
}
