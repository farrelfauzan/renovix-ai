import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { EmailJobService } from "../../email/service/email-job.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser, createWorkspace } from "../../../../test/factories";

// RNX-117 (answer 3): the default workspace holds the account's agents and cannot be archived (409, nothing
// changes). Another workspace of the same owner archives as before (control; the role rules are RX-15,
// workspace.ownership.spec.ts). Real controller and service, test database; email sending is never reached.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));

process.env.JWT_SECRET = "rnx117-archive-test-jwt-secret";

describe("RNX-117: archiving a default workspace (Fastify, test database)", () => {
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
        { provide: EmailJobService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  const readRows = () =>
    Promise.all([prisma.workspace.findMany({ orderBy: { id: "asc" } }), prisma.workspaceMember.findMany({ orderBy: { id: "asc" } }), prisma.agent.findMany()]);

  /** An owner with an agent in the default workspace and a second workspace with its owner member row. */
  const setup = async () => {
    const owner = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: owner.id });
    const other = await createWorkspace(prisma, { ownerId: owner.id });
    await prisma.workspaceMember.create({ data: { workspaceId: other.id, userId: owner.id, role: "owner" } });
    return { owner, defaultWorkspaceId: agent.workspaceId, other };
  };

  it("DELETE /workspaces/:id of the owner's default workspace: 409, nothing changes", async () => {
    const { owner, defaultWorkspaceId } = await setup();
    const rowsBefore = await readRows();

    const res = await app.inject({ method: "DELETE", url: `/workspaces/${defaultWorkspaceId}`, headers: auth(owner) });

    expect({ status: res.statusCode, rows: await readRows() }).toEqual({ status: 409, rows: rowsBefore });
    expect(res.json().message).toBe("The default workspace cannot be archived");
    expect(rowsBefore[0].find((w) => w.id === defaultWorkspaceId)).toMatchObject({ isDefault: true, status: "active" });
  });

  it("control: DELETE /workspaces/:id of the owner's other workspace archives it (200)", async () => {
    const { owner, defaultWorkspaceId, other } = await setup();

    const res = await app.inject({ method: "DELETE", url: `/workspaces/${other.id}`, headers: auth(owner) });

    expect(res.statusCode).toBe(200);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("archived");
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: defaultWorkspaceId } })).status).toBe("active");
  });
});
