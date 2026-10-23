import { ConfigModule } from "@nestjs/config";
import { Controller, HttpCode, Post } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Access } from "../decorators/access.decorator";
import { createFastifyAdapter } from "../utils/create-fastify-adapter";
import { ChannelController } from "../../app/channel/controller/channel.controller";
import { ChannelService } from "../../app/channel/service/channel.service";
import { ChannelChatService } from "../../app/channel/service/channel-chat.service";
import { PortalController } from "../../app/portal/controller/portal.controller";
import { PortalTierService } from "../../app/portal/service/portal-tier.service";
import { S3Service } from "../../app/knowledge/service/s3.service";
import { KnowledgeService } from "../../app/knowledge/service/knowledge.service";
import { EmbeddingService } from "../../app/knowledge/service/embedding.service";
import { DocumentService } from "../../app/document/service/document.service";
import { ModelRegistryService } from "../../app/config/model-registry.service";
import { ProvidersModule } from "../../app/providers/providers.module";
import { CreditService } from "../../app/billing/service/credit.service";
import { UsageService } from "../../app/usage/service/usage.service";
import { PromptTuningService } from "../../app/chat/service/prompt-tuning.service";
import { ConversationService } from "../../app/chat/service/conversation.service";
import { GuardrailService } from "../../app/guardrail/service/guardrail.service";
import { AgentRunPolicyService } from "../../app/agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../app/workspace/service/workspace-quota.service";
import { PrismaService } from "../../app/prisma/prisma.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";
import { fundPaidWallet } from "../../../test/credit-funding";
import { asSessionUser } from "../../../test/as-session-user";
import { createResolvableModel } from "../../../test/provider-model";
import { FakeProviderAdapter, withFakeProvider } from "../../../test/fake-provider";

// RNX-272: a session or portal write (POST, PUT, PATCH, DELETE) answers only the product's own origins
// (resolveCorsOrigins: CORS_ORIGIN, plus ADMIN_ORIGIN). Real HTTP (Fastify `inject`, multipart registered as in
// main.ts), the global guards of createTestModule, the test database. Storage and embeddings are test doubles
// (no S3, no provider); the portal chat answers through the fake provider. Each refused write leaves storage and
// the database untouched; each allowed one is the chat app's own flow and succeeds.
jest.mock("../../app/channel/service/channel-chat.service", () => ({ ChannelChatService: class {} }));
jest.mock("../../app/knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../app/knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../app/document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../app/agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../app/usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../app/chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../app/chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../app/guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

process.env.IP_HASH_SECRET = "rnx272-test-secret";
delete process.env.CLIENT_IP_HEADER;
delete process.env.ANON_DAILY_GLOBAL_CAP;

const CHAT_ORIGIN = "https://chat.example.test";
const EVIL_ORIGIN = "https://evil.example.test";
const PORTAL_SESSION = "27227227-2722-4722-8722-272272272272";
const BOUNDARY = "----rnx272boundary";

/** A multipart/form-data body with one file field: what a foreign page's <form enctype="multipart/form-data"> sends. */
const multipart = (filename: string, contentType: string, content: string) => ({
  "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
  payload:
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n${content}\r\n--${BOUNDARY}--\r\n`,
});
const ICON = multipart("icon.png", "image/png", "png-bytes");
const MARKDOWN = multipart("notes.md", "text/markdown", "# Notes\n\nWritten through the chat app.");

const unitVector = (): number[] => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

@Controller("origin-probe")
class OriginProbeController {
  @Post("public")
  @HttpCode(200)
  @Access({ public: true, reason: "test-only route (RNX-272): a public write is not checked by the user Origin guard" })
  publicWrite() {
    return { ok: true };
  }

  @Post("api-key")
  @HttpCode(200)
  @Access({ auth: ["apiKey"] })
  apiKeyWrite() {
    return { ok: true };
  }
}

const storage = {
  buildKey: (userId: string, knowledgeBaseId: string, filename: string) => `knowledge/${userId}/${knowledgeBaseId}/${filename}`,
  upload: jest.fn(async () => undefined),
  delete: jest.fn(async () => undefined),
};
const embedding = {
  embed: jest.fn(async (texts: string[]) => texts.map(() => ({ embedding: unitVector(), tokenCount: 1 }))),
};
const fake = new FakeProviderAdapter();

/** Starts the app with these environment values (undefined: unset) while it is built, restored afterwards. */
async function startWith(env: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.entries(env).forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value)));
  try {
    const { moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        controllers: [ChannelController, PortalController, OriginProbeController],
        providers: [
          ChannelService,
          AgentRunPolicyService,
          WorkspaceQuotaService,
          PortalTierService,
          ModelRegistryService,
          KnowledgeService,
          { provide: S3Service, useValue: storage },
          { provide: EmbeddingService, useValue: embedding },
          { provide: ChannelChatService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          { provide: CreditService, useValue: {} },
          { provide: UsageService, useValue: {} },
          { provide: ConversationService, useValue: {} },
          {
            provide: PromptTuningService,
            useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
          },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        ],
      },
      (builder) => withFakeProvider(builder, fake),
    );
    const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await app.getHttpAdapter().getInstance().register(require("@fastify/multipart"));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return { moduleRef, prisma, app };
  } finally {
    Object.entries(saved).forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value)));
  }
}

describe("RNX-272: Origin check on cookie-authenticated user writes (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma, app } = await startWith({ CORS_ORIGIN: CHAT_ORIGIN }));
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    storage.upload.mockClear();
    embedding.embed.mockClear();
    fake.requests.length = 0;
  });

  afterAll(() => app?.close());

  const signedInUser = async () => {
    const user = await createUser(prisma);
    return { user, cookie: asSessionUser(user) };
  };
  /** A signed-in portal user with credits (the knowledge base routes need a positive balance) and a base of their own. */
  const portalUserWithBase = async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    const knowledgeBase = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "Notes" } });
    return { knowledgeBase, headers: { "x-portal-session": PORTAL_SESSION, ...asSessionUser(user) } };
  };
  const ownedChannel = async () => {
    const { user, cookie } = await signedInUser();
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Original name" } });
    return { channel, cookie };
  };
  const uploadIcon = (headers: Record<string, string>) =>
    app.inject({ method: "POST", url: "/channels/upload-icon", headers: { ...headers, "content-type": ICON["content-type"] }, payload: ICON.payload });
  const uploadKnowledge = (knowledgeBaseId: string, headers: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: `/chat/portal/knowledge/${knowledgeBaseId}/upload`,
      headers: { ...headers, "content-type": MARKDOWN["content-type"] },
      payload: MARKDOWN.payload,
    });
  const renameChannel = (channelId: string, headers: Record<string, string>) =>
    app.inject({ method: "PATCH", url: `/channels/${channelId}`, headers, payload: { name: "Renamed" } });
  const deleteChannel = (channelId: string, headers: Record<string, string>) =>
    app.inject({ method: "DELETE", url: `/channels/${channelId}`, headers });
  const sendPortalMessage = (headers: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      remoteAddress: "203.0.113.72",
      headers: { "x-portal-session": PORTAL_SESSION, ...headers },
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });
  const seedFreeModel = async () => {
    await createResolvableModel(prisma, {
      slug: "standard-cheap",
      modelName: "standard-cheap",
      inputPrice: "0.000001",
      outputPrice: "0.000001",
      maxTokens: 8192,
      tier: "standard",
    });
    await moduleRef.get(ModelRegistryService).refresh();
  };

  describe("AC1: a foreign Origin with the user's cookie is refused (403) and nothing changes", () => {
    it("POST /channels/upload-icon (multipart): 403, no file stored", async () => {
      const { cookie } = await signedInUser();

      const actual = await uploadIcon({ ...cookie, origin: EVIL_ORIGIN });

      expect(actual.statusCode).toBe(403);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it("POST /chat/portal/knowledge/:id/upload (multipart): 403, no file stored, no chunk, no embedding call", async () => {
      const { knowledgeBase, headers } = await portalUserWithBase();

      const actual = await uploadKnowledge(knowledgeBase.id, { ...headers, origin: EVIL_ORIGIN });

      expect(actual.statusCode).toBe(403);
      expect(storage.upload).not.toHaveBeenCalled();
      expect(embedding.embed).not.toHaveBeenCalled();
      expect(await prisma.knowledgeChunk.count()).toBe(0);
    });

    it("PATCH /channels/:id: 403, the channel keeps its name", async () => {
      const { channel, cookie } = await ownedChannel();

      const actual = await renameChannel(channel.id, { ...cookie, origin: EVIL_ORIGIN });

      expect(actual.statusCode).toBe(403);
      expect((await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).name).toBe("Original name");
    });

    it("DELETE /channels/:id: 403, the channel kept", async () => {
      const { channel, cookie } = await ownedChannel();

      const actual = await deleteChannel(channel.id, { ...cookie, origin: EVIL_ORIGIN });

      expect(actual.statusCode).toBe(403);
      expect(await prisma.channel.count({ where: { id: channel.id } })).toBe(1);
    });

    it("POST /chat/portal/completions: 403, no model call and no portal session looked up or created", async () => {
      await seedFreeModel();

      const actual = await sendPortalMessage({ origin: EVIL_ORIGIN });

      expect(actual.statusCode).toBe(403);
      expect(fake.requests).toHaveLength(0);
      expect(await prisma.portalSession.count()).toBe(0);
    });
  });

  describe("AC2: without an Origin, the Referer decides; with neither header a write is refused", () => {
    it("no Origin, a Referer from a foreign origin: 403, no file stored", async () => {
      const { cookie } = await signedInUser();

      const actual = await uploadIcon({ ...cookie, referer: `${EVIL_ORIGIN}/attack.html` });

      expect(actual.statusCode).toBe(403);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it("no Origin, a Referer that is not a URL: 403, no file stored", async () => {
      const { cookie } = await signedInUser();

      const actual = await uploadIcon({ ...cookie, referer: "not a url" });

      expect(actual.statusCode).toBe(403);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it("neither Origin nor Referer on a POST: 403, no file stored", async () => {
      const { cookie } = await signedInUser();

      const actual = await uploadIcon(cookie);

      expect(actual.statusCode).toBe(403);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it("neither Origin nor Referer on a DELETE: 403, the channel kept", async () => {
      const { channel, cookie } = await ownedChannel();

      const actual = await deleteChannel(channel.id, cookie);

      expect(actual.statusCode).toBe(403);
      expect(await prisma.channel.count({ where: { id: channel.id } })).toBe(1);
    });

    it("no Origin, a Referer from the allowed origin: the upload succeeds", async () => {
      const { cookie } = await signedInUser();

      const actual = await uploadIcon({ ...cookie, referer: `${CHAT_ORIGIN}/channels/new` });

      expect(actual.statusCode).toBe(200);
      expect(storage.upload).toHaveBeenCalledTimes(1);
    });
  });

  describe("AC3: the chat app's own writes, from the allowed origin, succeed", () => {
    it("upload an icon: 200, the file stored under the user's key", async () => {
      const { user, cookie } = await signedInUser();

      const actual = await uploadIcon({ ...cookie, origin: CHAT_ORIGIN });

      expect(actual.statusCode).toBe(200);
      expect(actual.json().icon).toMatch(new RegExp(`^channels/${user.id}/icons/\\d+\\.png$`));
      expect(storage.upload).toHaveBeenCalledWith(actual.json().icon, expect.any(Buffer), "image/png");
    });

    it("upload a knowledge file: 201, the file stored and its chunks saved", async () => {
      const { knowledgeBase, headers } = await portalUserWithBase();

      const actual = await uploadKnowledge(knowledgeBase.id, { ...headers, origin: CHAT_ORIGIN });

      expect(actual.statusCode).toBe(201);
      expect(actual.json()).toMatchObject({ filename: "notes.md", chunksInserted: 1 });
      expect(storage.upload).toHaveBeenCalledTimes(1);
      expect(await prisma.knowledgeChunk.count({ where: { knowledgeBaseId: knowledgeBase.id } })).toBe(1);
    });

    it("send a message (POST /chat/portal/completions, as apps/chat/src/lib/api.ts): 200, the fake provider's answer", async () => {
      await seedFreeModel();
      fake.enqueue({ content: "fake-answer" });

      const actual = await sendPortalMessage({ origin: CHAT_ORIGIN });

      expect(actual.statusCode).toBe(200);
      expect(actual.body).toContain('"content":"fake-answer"');
      expect(actual.body).toContain("data: [DONE]");
      expect(fake.requests).toHaveLength(1);
    });

    it("rename a channel (PATCH): 200, the new name stored", async () => {
      const { channel, cookie } = await ownedChannel();

      const actual = await renameChannel(channel.id, { ...cookie, origin: CHAT_ORIGIN });

      expect(actual.statusCode).toBe(200);
      expect((await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).name).toBe("Renamed");
    });

    it("delete a channel (DELETE): 204, the channel gone", async () => {
      const { channel, cookie } = await ownedChannel();

      const actual = await deleteChannel(channel.id, { ...cookie, origin: CHAT_ORIGIN });

      expect(actual.statusCode).toBe(204);
      expect(await prisma.channel.count({ where: { id: channel.id } })).toBe(0);
    });
  });

  describe("AC4: what the check leaves alone", () => {
    it("a GET on a session route from a foreign Origin: 200 (reads are not checked)", async () => {
      const { cookie } = await signedInUser();

      const actual = await app.inject({ method: "GET", url: "/channels", headers: { ...cookie, origin: EVIL_ORIGIN } });

      expect(actual.statusCode).toBe(200);
    });

    it.each([
      ["a foreign Origin", { origin: EVIL_ORIGIN }],
      ["no Origin and no Referer", {}],
    ])("a public write with %s: 200 (public routes are not checked)", async (_name, inputHeaders) => {
      const actual = await app.inject({ method: "POST", url: "/origin-probe/public", headers: inputHeaders });

      expect(actual.statusCode).toBe(200);
    });

    it.each([
      ["a foreign Origin", { origin: EVIL_ORIGIN }],
      ["no Origin and no Referer", {}],
    ])("an API key write with %s and no key: 401 from AccessGuard's key check, not this guard's 403", async (_name, inputHeaders) => {
      const actual = await app.inject({ method: "POST", url: "/origin-probe/api-key", headers: inputHeaders });

      expect(actual.statusCode).toBe(401);
    });
  });
});

describe("RNX-272: with CORS_ORIGIN unset every origin passes the check (today's development behaviour, until RNX-70)", () => {
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ prisma, app } = await startWith({ CORS_ORIGIN: undefined }));
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    storage.upload.mockClear();
  });

  afterAll(() => app?.close());

  it("a foreign Origin's multipart upload with the user's cookie succeeds", async () => {
    const user = await createUser(prisma);

    const actual = await app.inject({
      method: "POST",
      url: "/channels/upload-icon",
      headers: { ...asSessionUser(user), origin: EVIL_ORIGIN, "content-type": ICON["content-type"] },
      payload: ICON.payload,
    });

    expect(actual.statusCode).toBe(200);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it("a DELETE with neither Origin nor Referer succeeds", async () => {
    const user = await createUser(prisma);
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Unset list" } });

    const actual = await app.inject({ method: "DELETE", url: `/channels/${channel.id}`, headers: asSessionUser(user) });

    expect(actual.statusCode).toBe(204);
    expect(await prisma.channel.count({ where: { id: channel.id } })).toBe(0);
  });
});
