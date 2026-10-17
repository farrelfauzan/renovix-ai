import { Injectable, Logger } from "@nestjs/common";
import { UserMemoryRepository } from "../repository/user-memory.repository";
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

  constructor(private readonly memories: UserMemoryRepository) {}

  async listActive(userId: string): Promise<MemoryItem[]> {
    return this.memories.listActiveMemories(userId);
  }

  async listAll(userId: string): Promise<MemoryItem[]> {
    return this.memories.listVisibleMemories(userId);
  }

  async getById(userId: string, id: string): Promise<MemoryItem | null> {
    return this.memories.findVisibleMemory(id, userId);
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
    return this.memories.createMemory(userId, {
      type: data.type,
      content: data.content,
      confidence: data.confidence ?? 0.75,
      sourceMessageId: data.sourceMessageId ?? null,
      sourceConversationId: data.sourceConversationId ?? null,
    });
  }

  async update(
    userId: string,
    id: string,
    data: { content?: string; isUserPinned?: boolean },
  ): Promise<MemoryItem | null> {
    const existing = await this.memories.findVisibleMemory(id, userId);
    if (!existing) return null;

    return this.memories.updateMemory(id, {
      ...(data.content !== undefined && { content: data.content }),
      ...(data.isUserPinned !== undefined && {
        isUserPinned: data.isUserPinned,
      }),
      lastConfirmedAt: new Date(),
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const existing = await this.memories.findVisibleMemory(id, userId);
    if (!existing) return false;

    await this.memories.updateMemory(id, { status: "deleted" });
    return true;
  }

  async clearAll(userId: string): Promise<number> {
    return this.memories.markAllMemoriesDeleted(userId);
  }

  async getRelevantMemories(
    userId: string,
    maxItems = 8,
  ): Promise<MemoryItem[]> {
    return this.memories.findRelevantMemories(userId, maxItems);
  }

  async confirmMemory(userId: string, id: string): Promise<void> {
    await this.memories.confirmMemory(userId, id);
  }

  async archiveConflicting(
    userId: string,
    newContent: string,
    type: string,
  ): Promise<void> {
    // Find similar memories of the same type and archive them
    const existing = await this.memories.listActiveMemoriesOfType(userId, type);

    for (const mem of existing) {
      // Simple overlap check - if the new content seems to override this
      const overlap = hasConflict(mem.content, newContent);
      if (overlap) {
        await this.memories.updateMemory(mem.id, { status: "archived" });
        this.logger.debug(`Archived conflicting memory: ${mem.id}`);
      }
    }
  }

  async findDuplicate(
    userId: string,
    content: string,
    type: string,
  ): Promise<MemoryItem | null> {
    const existing = await this.memories.listActiveMemoriesOfType(userId, type);

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
