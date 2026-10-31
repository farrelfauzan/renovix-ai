import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { WorkspaceKnowledgeService } from "../service/workspace-knowledge.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { EmailJobService } from "../../email/service/email-job.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createPlan, createSubscription, createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-251: creating a workspace needs a package (a purchase snapshot), read through EntitlementService; a
// user_subscriptions row no longer decides it. Real controller and services on the test database.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

const NO_PACKAGE = "Active AI Agent subscription required. Please upgrade to access workspaces.";

describe("RNX-251: POST /workspaces behind the package gate (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [WorkspaceController],
      providers: [
        WorkspaceService,
        WorkspaceMemberService,
        WorkspaceInviteService,
        WorkspaceQuotaService,
        WorkspaceKnowledgeService,
        EntitlementService,
        { provide: EmailJobService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: S3Service, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const createWorkspace = (user: { id: string; email: string }) =>
    app.inject({ method: "POST", url: "/workspaces", headers: asSessionUser(user), payload: { name: "Team space" } });

  it("a Starter package (a purchase snapshot, no user_subscriptions row) creates a workspace (201)", async () => {
    const inputUser = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: inputUser.id, name: "Starter" });

    const actualResponse = await createWorkspace(inputUser);

    expect(actualResponse.statusCode).toBe(201);
    expect(actualResponse.json()).toMatchObject({ ownerId: inputUser.id, name: "Team space" });
    expect(await prisma.workspace.count({ where: { ownerId: inputUser.id, name: "Team space" } })).toBe(1);
    expect(await prisma.userSubscription.count()).toBe(0);
  });

  it("no package: 403 with the old message, nothing created", async () => {
    const inputUser = await createUser(prisma);

    const actualResponse = await createWorkspace(inputUser);

    expect(actualResponse.statusCode).toBe(403);
    expect(actualResponse.json().message).toBe(NO_PACKAGE);
    expect(await prisma.workspace.count({ where: { ownerId: inputUser.id } })).toBe(0);
  });

  it("an active user_subscriptions row without a package no longer passes: 403", async () => {
    const inputUser = await createUser(prisma);
    await createSubscription(prisma, { userId: inputUser.id, planId: (await createPlan(prisma)).id, status: "active" });

    const actualResponse = await createWorkspace(inputUser);

    expect(actualResponse.statusCode).toBe(403);
    expect(await prisma.workspace.count({ where: { ownerId: inputUser.id } })).toBe(0);
  });
});
