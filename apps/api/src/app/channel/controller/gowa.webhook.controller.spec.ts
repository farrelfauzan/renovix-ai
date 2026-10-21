import { createHmac } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { GowaWebhookController } from "./gowa.webhook.controller";
import { GowaService } from "../service/gowa.service";
import { AgentRunService } from "../../agent/service/agent-run.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";

// RX-115: POST /webhooks/gowa through Fastify on the test database. GOWA (v9.6.0, note R-8)
// signs with `X-Hub-Signature-256: sha256=<lowercase hex HMAC-SHA256(secret, raw body)>`.
// The agent run is a mock (no model is called) and sending the reply back to GOWA is stubbed.
// Made-up secrets and numbers only.
// The real AgentRunService pulls in the document converters (marked is ESM-only); it is a mock here anyway.
jest.mock("../../agent/service/agent-run.service", () => ({ AgentRunService: class {} }));

const SECRET = "made-up-gowa-webhook-secret";
const OTHER_SECRET = "another-made-up-secret";
const TO = "628111000111";
const FROM = "628222000222";
const REFUSAL = "Invalid webhook signature";

const hmacHex = (secret: string, raw: string): string =>
  createHmac("sha256", secret).update(raw).digest("hex");
const signed = (secret: string, raw: string) => ({
  "x-hub-signature-256": `sha256=${hmacHex(secret, raw)}`,
});
const inbound = (text: string, overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    event: "message.received",
    from: FROM,
    to: TO,
    message: { id: "wamid-1", type: "text", text: { body: text }, timestamp: 1 },
    ...overrides,
  });

describe("RX-115: GOWA webhook refuses unsigned calls (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let sendMessage: jest.SpyInstance;
  const runService = { chat: jest.fn() };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [GowaWebhookController],
      providers: [GowaService, { provide: AgentRunService, useValue: runService }],
    }));
    // rawBody: true as in main.ts, so the handler gets the bytes GOWA signed.
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { rawBody: true },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sendMessage = jest.spyOn(moduleRef.get(GowaService), "sendMessage");
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    runService.chat.mockReset().mockResolvedValue({ message: { content: "Agent reply" } });
    sendMessage.mockReset().mockResolvedValue(undefined);
  });

  afterAll(() => app?.close());

  const createWhatsappChannel = async (config: Record<string, string>) => {
    const user = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: user.id });
    await prisma.agentChannel.create({
      data: { agentId: agent.id, channelType: "whatsapp", status: "active", config },
    });
    return agent;
  };
  const withSecret = () =>
    createWhatsappChannel({ phoneNumber: TO, webhookSecret: SECRET, gowaUrl: "http://gowa.invalid", apiToken: "made-up" });

  const post = (raw: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url: "/webhooks/gowa",
      headers: { "content-type": "application/json", ...headers },
      payload: raw,
    });

  const expectRefusedAndNothingProcessed = async (res: Awaited<ReturnType<typeof post>>) => {
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe(REFUSAL);
    expect(runService.chat).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(await prisma.agentRun.count()).toBe(0);
    expect(await prisma.agentMessage.count()).toBe(0);
    expect(await prisma.channelMessage.count()).toBe(0);
  };

  it("(a) no x-hub-signature-256 header: 401, nothing processed", async () => {
    await withSecret();

    const res = await post(inbound("Halo"));

    await expectRefusedAndNothingProcessed(res);
  });

  it.each([
    ["an opt-out (STOP)", inbound("STOP")],
    ["another event type", inbound("Halo", { event: "message.ack" })],
    ["a non-text message", inbound("Halo", { message: { id: "wamid-2", type: "image", timestamp: 1 } })],
  ])("(a) unsigned %s is 401 too: the signature is checked before any other branch", async (_name, raw) => {
    await withSecret();

    const res = await post(raw);

    await expectRefusedAndNothingProcessed(res);
  });

  it("(b) the channel has no webhookSecret: 401 even with a signed call, nothing processed", async () => {
    await createWhatsappChannel({ phoneNumber: TO, gowaUrl: "http://gowa.invalid", apiToken: "made-up" });
    const raw = inbound("Halo");

    const res = await post(raw, signed(SECRET, raw));

    await expectRefusedAndNothingProcessed(res);
  });

  it("(b) the channel has an empty webhookSecret: 401 for a call signed with the empty key", async () => {
    await createWhatsappChannel({ phoneNumber: TO, webhookSecret: "", gowaUrl: "http://gowa.invalid", apiToken: "made-up" });
    const raw = inbound("Halo");

    const res = await post(raw, signed("", raw));

    await expectRefusedAndNothingProcessed(res);
  });

  it("(c) signed with another key: 401, nothing processed", async () => {
    await withSecret();
    const raw = inbound("Halo");

    const res = await post(raw, signed(OTHER_SECRET, raw));

    await expectRefusedAndNothingProcessed(res);
  });

  it("(d) right signature but the body changed by one byte after signing: 401", async () => {
    await withSecret();
    const raw = inbound("Halo");
    const changed = inbound("Hali");

    const res = await post(changed, signed(SECRET, raw));

    await expectRefusedAndNothingProcessed(res);
  });

  it.each([
    ["without the sha256= prefix", (hex: string) => hex],
    ["followed by extra text", (hex: string) => `sha256=${hex}zz`],
    ["with 2 more hex characters", (hex: string) => `sha256=${hex}00`],
    ["with another prefix", (hex: string) => `sha1=${hex}`],
  ])("(e) the right HMAC %s: 401", async (_name, format) => {
    await withSecret();
    const raw = inbound("Halo");

    const res = await post(raw, { "x-hub-signature-256": format(hmacHex(SECRET, raw)) });

    await expectRefusedAndNothingProcessed(res);
  });

  it("(f) a valid signature over the raw bytes is processed as before, also when JSON.stringify of the body differs", async () => {
    const agent = await withSecret();
    // Go's encoder escapes <, > and & (<, >, &); whitespace and newlines as sent.
    const raw =
      `{\n  "event": "message.received",\n  "from": "${FROM}",\n  "to": "${TO}",\n` +
      `  "message": { "id": "wamid-1", "type": "text", "text": { "body": "Halo \\u0026 \\u003cb\\u003e " }, "timestamp": 1 }\n}\n`;
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);

    const res = await post(raw, signed(SECRET, raw));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, messageId: "wamid-1" });
    expect(runService.chat).toHaveBeenCalledTimes(1);
    expect(runService.chat).toHaveBeenCalledWith(agent.userId, agent.id, "Halo & <b>", `wa:${FROM}:${TO}`);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(FROM, "Agent reply", expect.objectContaining({ phoneNumber: TO }));
  });

  it("RNX-28: a signed event other than message.received (no from, no message) is skipped with 200, nothing processed", async () => {
    await withSecret();
    const raw = JSON.stringify({ event: "message.ack", to: TO, ack: { id: "wamid-1", status: "read" } });

    const res = await post(raw, signed(SECRET, raw));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, skipped: true });
    expect(runService.chat).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["the victim's channel was saved first", true],
    ["another tenant saved the same number first", false],
  ])("(h) two tenants with the same number (%s): each call runs the agent of the channel whose secret signed it", async (_name, victimFirst) => {
    const saveVictim = () =>
      createWhatsappChannel({ phoneNumber: TO, webhookSecret: SECRET, gowaUrl: "http://gowa.invalid", apiToken: "made-up" });
    const saveOther = () =>
      createWhatsappChannel({ phoneNumber: TO, webhookSecret: OTHER_SECRET, gowaUrl: "http://gowa.invalid", apiToken: "made-up" });
    const victim = victimFirst ? await saveVictim() : (await saveOther(), await saveVictim());
    const other = victimFirst ? await saveOther() : (await prisma.agent.findFirstOrThrow({ where: { NOT: { id: victim.id } } }));
    const raw = inbound("Halo");

    const victimCall = await post(raw, signed(SECRET, raw));
    const otherCall = await post(raw, signed(OTHER_SECRET, raw));

    expect(victimCall.statusCode).toBe(200);
    expect(otherCall.statusCode).toBe(200);
    expect(runService.chat).toHaveBeenNthCalledWith(1, victim.userId, victim.id, "Halo", `wa:${FROM}:${TO}`);
    expect(runService.chat).toHaveBeenNthCalledWith(2, other.userId, other.id, "Halo", `wa:${FROM}:${TO}`);
  });

  it("(g) no channel resolves for payload.to: 401, nothing processed", async () => {
    await withSecret();
    const raw = inbound("Halo", { to: "628999000999" });

    const res = await post(raw, signed(SECRET, raw));

    await expectRefusedAndNothingProcessed(res);
  });
});
