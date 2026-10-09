import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "./channel.service";
import { ChannelChatService } from "./channel-chat.service";
import { S3Service } from "../knowledge/s3.service";
import { DocumentService } from "../document/document.service";
import { AgentToolService } from "../agent/agent-tool.service";
import { ProviderRouter } from "../providers/provider-router";
import { PrismaService } from "../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createAgent, createUser } from "../../../test/factories";

// RX-15 characterization: channel ownership through the real controller and
// ChannelService (CombinedAuthGuard JWT path, test database). The chat, upload
// and document collaborators are not used by these routes: empty stubs, and
// their modules are replaced because they load ESM-only packages.
jest.mock("../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("./channel-chat.service", () => ({ ChannelChatService: class {} }));
jest.mock("../knowledge/s3.service", () => ({ S3Service: class {} }));
jest.mock("../document/document.service", () => ({ DocumentService: class {} }));
jest.mock("../agent/agent-tool.service", () => ({ AgentToolService: class {} }));

process.env.JWT_SECRET = "rx15-test-jwt-secret";

describe("Channels: ownership (RX-15, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ChannelController],
      providers: [
        ChannelService,
        { provide: ChannelChatService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: DocumentService, useValue: {} },
        { provide: AgentToolService, useValue: {} },
        { provide: ProviderRouter, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  const setup = async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const aliceAgent = await createAgent(prisma, { userId: alice.id });
    const channel = await prisma.channel.create({
      data: { userId: alice.id, name: "Alice channel" },
    });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: aliceAgent.id } });
    return { alice, bob, aliceAgent, channel };
  };

  it.each([
    ["GET", "/channels"],
    ["GET", "/channels/00000000-0000-4000-8000-000000000000"],
    ["PATCH", "/channels/00000000-0000-4000-8000-000000000000"],
    ["DELETE", "/channels/00000000-0000-4000-8000-000000000000"],
  ] as const)("not signed in: %s %s is 401", async (method, url) => {
    const res = await app.inject({ method, url, payload: method === "PATCH" ? {} : undefined });

    expect(res.statusCode).toBe(401);
  });

  it("owner can read and change their channel (positive control)", async () => {
    const { alice, channel, aliceAgent } = await setup();

    const read = await app.inject({ method: "GET", url: `/channels/${channel.id}`, headers: auth(alice) });
    expect(read.statusCode).toBe(200);
    expect(read.json().id).toBe(channel.id);

    const messages = await app.inject({
      method: "GET",
      url: `/channels/${channel.id}/agents/${aliceAgent.id}/messages`,
      headers: auth(alice),
    });
    expect(messages.statusCode).toBe(200);

    const update = await app.inject({
      method: "PATCH",
      url: `/channels/${channel.id}`,
      headers: auth(alice),
      payload: { name: "Renamed by owner" },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().name).toBe("Renamed by owner");
  });

  it("another user cannot read it: GET /channels/:id and its messages are 404, the list leaves it out", async () => {
    const { bob, channel, aliceAgent } = await setup();

    const read = await app.inject({ method: "GET", url: `/channels/${channel.id}`, headers: auth(bob) });
    expect(read.statusCode).toBe(404);

    const messages = await app.inject({
      method: "GET",
      url: `/channels/${channel.id}/agents/${aliceAgent.id}/messages`,
      headers: auth(bob),
    });
    expect(messages.statusCode).toBe(404);

    const list = await app.inject({ method: "GET", url: "/channels", headers: auth(bob) });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);
  });

  it.each([
    ["PATCH", "", { name: "Renamed by bob" }],
    ["DELETE", "", undefined],
  ] as const)("another user cannot change it: %s /channels/:id%s is 404, channel unchanged", async (method, suffix, payload) => {
    const { bob, channel } = await setup();

    const res = await app.inject({ method, url: `/channels/${channel.id}${suffix}`, headers: auth(bob), payload });

    expect(res.statusCode).toBe(404);
    expect(await prisma.channel.findUnique({ where: { id: channel.id } })).toMatchObject({
      name: "Alice channel",
    });
  });

  it("another user cannot add an agent to it, remove one, or clear its messages (404)", async () => {
    const { bob, channel, aliceAgent } = await setup();
    const bobAgent = await createAgent(prisma, { userId: bob.id });

    const add = await app.inject({
      method: "POST",
      url: `/channels/${channel.id}/agents`,
      headers: auth(bob),
      payload: { agentId: bobAgent.id },
    });
    const remove = await app.inject({
      method: "DELETE",
      url: `/channels/${channel.id}/agents/${aliceAgent.id}`,
      headers: auth(bob),
    });
    const clear = await app.inject({
      method: "DELETE",
      url: `/channels/${channel.id}/agents/${aliceAgent.id}/messages`,
      headers: auth(bob),
    });

    expect([add.statusCode, remove.statusCode, clear.statusCode]).toEqual([404, 404, 404]);
    const links = await prisma.channelAgent.findMany({ where: { channelId: channel.id } });
    expect(links.map((l) => l.agentId)).toEqual([aliceAgent.id]);
  });

  it("the owner cannot add another user's private agent (404); a public active one is allowed by design", async () => {
    const { alice, bob, channel } = await setup();
    const bobPrivate = await createAgent(prisma, { userId: bob.id });
    const bobPublic = await createAgent(prisma, { userId: bob.id, isPublic: true, status: "active" });

    const privateRes = await app.inject({
      method: "POST",
      url: `/channels/${channel.id}/agents`,
      headers: auth(alice),
      payload: { agentId: bobPrivate.id },
    });
    const publicRes = await app.inject({
      method: "POST",
      url: `/channels/${channel.id}/agents`,
      headers: auth(alice),
      payload: { agentId: bobPublic.id },
    });

    expect(privateRes.statusCode).toBe(404);
    expect(publicRes.statusCode).toBe(201);
  });
});
