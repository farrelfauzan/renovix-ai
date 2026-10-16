import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { hasConflict } from "../utils/has-conflict";

export interface MemoryItem {
  id: string;
  userId: string;
  type: string;
  content: string;
  confidence: number;
  sourceMessageId: string | null;
  sourceConversationId: string | null;
  lastConfirmedAt: Date;
  expiresAt: Date | null;
  isUserPinned: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UserMemoryService {
  private readonly logger = new Logger(UserMemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listActive(userId: string): Promise<MemoryItem[]> {
    return this.prisma.userMemory.findMany({
      where: { userId, status: "active" },
      orderBy: [{ isUserPinned: "desc" }, { lastConfirmedAt: "desc" }],
    });
  }

  async listAll(userId: string): Promise<MemoryItem[]> {
    return this.prisma.userMemory.findMany({
      where: { userId, status: { not: "deleted" } },
      orderBy: [{ isUserPinned: "desc" }, { lastConfirmedAt: "desc" }],
    });
  }

  async getById(userId: string, id: string): Promise<MemoryItem | null> {
    return this.prisma.userMemory.findFirst({
      where: { id, userId, status: { not: "deleted" } },
    });
  }

  async create(
    userId: string,
    data: {
      type: string;
      content: string;
      confidence?: number;
      sourceMessageId?: string;
      sourceConversationId?: string;
    },
  ): Promise<MemoryItem> {
    return this.prisma.userMemory.create({
      data: {
        userId,
        type: data.type,
        content: data.content,
        confidence: data.confidence ?? 0.75,
        sourceMessageId: data.sourceMessageId ?? null,
        sourceConversationId: data.sourceConversationId ?? null,
      },
    });
  }

  async update(
    userId: string,
    id: string,
    data: { content?: string; isUserPinned?: boolean },
  ): Promise<MemoryItem | null> {
    const existing = await this.prisma.userMemory.findFirst({
      where: { id, userId, status: { not: "deleted" } },
    });
    if (!existing) return null;

    return this.prisma.userMemory.update({
      where: { id },
      data: {
        ...(data.content !== undefined && { content: data.content }),
        ...(data.isUserPinned !== undefined && {
          isUserPinned: data.isUserPinned,
        }),
        lastConfirmedAt: new Date(),
      },
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const existing = await this.prisma.userMemory.findFirst({
      where: { id, userId, status: { not: "deleted" } },
    });
    if (!existing) return false;

    await this.prisma.userMemory.update({
      where: { id },
      data: { status: "deleted" },
    });
    return true;
  }

  async clearAll(userId: string): Promise<number> {
    const result = await this.prisma.userMemory.updateMany({
      where: { userId, status: { not: "deleted" } },
      data: { status: "deleted" },
    });
    return result.count;
  }

  async getRelevantMemories(
    userId: string,
    maxItems = 8,
  ): Promise<MemoryItem[]> {
    const memories = await this.prisma.userMemory.findMany({
      where: {
        userId,
        status: "active",
        confidence: { gte: 0.55 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [
        { isUserPinned: "desc" },
        { confidence: "desc" },
        { lastConfirmedAt: "desc" },
      ],
      take: maxItems,
    });

    return memories;
  }

  async confirmMemory(userId: string, id: string): Promise<void> {
    await this.prisma.userMemory.updateMany({
      where: { id, userId },
      data: { lastConfirmedAt: new Date(), confidence: 0.9 },
    });
  }

  async archiveConflicting(
    userId: string,
    newContent: string,
    type: string,
  ): Promise<void> {
    // Find similar memories of the same type and archive them
    const existing = await this.prisma.userMemory.findMany({
      where: { userId, type, status: "active" },
    });

    for (const mem of existing) {
      // Simple overlap check - if the new content seems to override this
      const overlap = hasConflict(mem.content, newContent);
      if (overlap) {
        await this.prisma.userMemory.update({
          where: { id: mem.id },
          data: { status: "archived" },
        });
        this.logger.debug(`Archived conflicting memory: ${mem.id}`);
      }
    }
  }

  async findDuplicate(
    userId: string,
    content: string,
    type: string,
  ): Promise<MemoryItem | null> {
    const existing = await this.prisma.userMemory.findMany({
      where: { userId, type, status: "active" },
    });

    for (const mem of existing) {
      const normalizedExisting = mem.content.toLowerCase().trim();
      const normalizedNew = content.toLowerCase().trim();

      if (
        normalizedExisting === normalizedNew ||
        normalizedExisting.includes(normalizedNew) ||
        normalizedNew.includes(normalizedExisting)
      ) {
        return mem;
      }
    }

    return null;
  }
}
