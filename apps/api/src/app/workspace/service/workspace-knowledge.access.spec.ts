import { WorkspaceKnowledgeService } from "./workspace-knowledge.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { EmbeddingService } from "../../knowledge/service/embedding.service";
import type { S3Service } from "../../knowledge/service/s3.service";
import type { KnowledgeChunkRepository } from "../../knowledge/repository/knowledge-chunk.repository";
import type { WorkspaceMemberRepository } from "../repository/workspace-member.repository";
import type { WorkspaceQuotaService } from "./workspace-quota.service";

// RNX-116 review NIT 1: WorkspaceKnowledgeService.canSearchKnowledgeBase on a personal base, in isolation. The run
// path also has KnowledgeService.searchChunks' own owner guard, which hides a missing check here; this unit test pins
// this method's owner check by itself. No database: the collaborators are stubs that fail if a personal base reaches them.
describe("RNX-116: canSearchKnowledgeBase on a personal base", () => {
  const findMembership = jest.fn(async () => {
    throw new Error("a personal base must not read workspace membership");
  });
  const isCollaborationAllowed = jest.fn(async () => true);
  const service = new WorkspaceKnowledgeService(
    {} as PrismaService,
    {} as EmbeddingService,
    {} as S3Service,
    {} as KnowledgeChunkRepository,
    { findMembership } as unknown as WorkspaceMemberRepository,
    { isCollaborationAllowed } as unknown as WorkspaceQuotaService,
  );
  const alicesPersonalBase = { userId: "alice", workspaceId: null };

  it("negative: another user's personal base → false", async () => {
    const actualCanSearch = await service.canSearchKnowledgeBase("bob", alicesPersonalBase);

    expect(actualCanSearch).toBe(false);
  });

  it("control: the owner's own personal base → true, without any workspace read", async () => {
    const actualCanSearch = await service.canSearchKnowledgeBase("alice", alicesPersonalBase);

    expect(actualCanSearch).toBe(true);
    expect(findMembership).not.toHaveBeenCalled();
    expect(isCollaborationAllowed).not.toHaveBeenCalled();
  });
});
