import { Logger } from "@nestjs/common";
import { EventEmitter } from "node:events";
import { ChannelController } from "./channel.controller";
import { ProviderRouter } from "../../providers/provider-router";
import type { ChatRequest, ChatResponse } from "../../providers/provider.interface";
import { ProviderTimeBudgetExceededError } from "../../providers/errors/provider-time-budget-exceeded-error";
import { FakeProviderAdapter } from "../../../../test/fake-provider";
import { testConnection } from "../../../../test/provider-model";

// RNX-325: the document-intent classifier call of POST /channels/:id/agents/:agentId/chat carries the model-call time budget (RNX-44).
// The real route action (ChannelController.chat) runs with a real ProviderRouter over the fake adapter, fake timers and
// stubs for the chat service and the settings; no database. The classifier runs AFTER the SSE headers on this route (the stream is open, with heartbeats, while it waits).
// The chat service, S3 and the document service load ESM-only packages.
jest.mock("../service/channel-chat.service", () => ({ ChannelChatService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const BUDGET_SECONDS = 10;
const BUDGET_MS = BUDGET_SECONDS * 1000;
/** The breaker's number (provider-circuit-breaker.ts). */
const FAILURES_TO_OPEN = 5;
const CHANNEL_ID = "7f6f6b0e-1a6c-4f4b-9d3f-0c1f4a3a9a11";
const AGENT_ID = "0b1d6f0e-2a6c-4f4b-9d3f-0c1f4a3a9a22";
const NOT_FAKED = ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"] as const;

const answer = (content: string): ChatResponse => ({
  id: "gen-1",
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

/** A raw response that records whether the SSE headers were written. */
const createRawResponse = () => {
  const raw = Object.assign(new EventEmitter(), {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    req: { headers: {} },
    socket: { setTimeout: jest.fn() },
    writeHead: jest.fn(() => void (raw.headersSent = true)),
    write: jest.fn(),
    end: jest.fn(() => void (raw.writableEnded = true)),
  });
  return raw;
};

describe("RNX-325: the channel chat's document-intent classifier call gets the model-call time budget", () => {
  let fake: FakeProviderAdapter;
  let router: ProviderRouter;
  let raw: ReturnType<typeof createRawResponse>;
  let routerChat: jest.SpyInstance;
  const runChat = jest.fn(async (..._args: unknown[]) => ({ content: "reply" }));
  const getSetting = jest.fn(async (): Promise<number | null> => BUDGET_SECONDS);
  const connection = testConnection({ slug: "standard-cheap", providerName: "provider-p1", providerRecordId: "provider-p1" });

  const buildController = (): ChannelController =>
    new ChannelController(
      {} as never,
      { assertRunCanStart: async () => undefined, chat: runChat } as never,
      {} as never,
      {} as never,
      router,
      { resolveCheapestConnection: async () => connection } as never,
      { getSetting } as never,
    );

  /** Fires the route: a message without output_format. */
  const fireRoute = (): Promise<unknown> =>
    buildController().chat(CHANNEL_ID, AGENT_ID, { message: "hello" }, { user: { userId: "u1" }, raw }, { raw } as never);

  const classifierRequest = (): ChatRequest => routerChat.mock.calls[0][0];

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: [...NOT_FAKED] });
    for (const level of ["log", "warn", "error"] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    fake = new FakeProviderAdapter();
    router = new ProviderRouter(fake);
    routerChat = jest.spyOn(router, "chat");
    raw = createRawResponse();
    runChat.mockClear();
    getSetting.mockReset().mockResolvedValue(BUDGET_SECONDS);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("AC1: a provider that never answers the classifier: the stream is already open, and at the budget the run continues as a non-document answer", async () => {
    jest.spyOn(fake, "chat").mockImplementation(() => new Promise<ChatResponse>(() => undefined));

    const routing = fireRoute();
    await jest.advanceTimersByTimeAsync(BUDGET_MS - 1);
    expect(raw.writeHead).toHaveBeenCalledTimes(1);
    expect(runChat).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await routing;

    expect(classifierRequest().timeBudgetMs).toBe(BUDGET_MS);
    expect(raw.writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(runChat).toHaveBeenCalledTimes(1);
    expect(runChat.mock.calls[0][4]).toEqual({ signal: expect.any(AbortSignal) }); // no documentFormat option (RNX-24a: the abort signal only)
    expect(raw.write).toHaveBeenCalledWith(expect.stringContaining('"status":"understanding"'));
  });

  it("AC3: with modelCallBudgetSeconds not set the classifier call is sent without timeBudgetMs", async () => {
    getSetting.mockResolvedValue(null);
    jest.spyOn(fake, "chat").mockResolvedValue(answer("none"));

    await fireRoute();

    expect(classifierRequest()).not.toHaveProperty("timeBudgetMs");
    expect(runChat).toHaveBeenCalledTimes(1);
  });

  it("AC4 (D332): classifier calls ending by the time budget do not open the provider's breaker; the next call is tried normally", async () => {
    const chat = jest.spyOn(fake, "chat").mockImplementation(() => new Promise<ChatResponse>(() => undefined));
    for (let i = 0; i < FAILURES_TO_OPEN + 1; i++) {
      const routing = fireRoute();
      await jest.advanceTimersByTimeAsync(BUDGET_MS);
      await routing;
    }
    const outcomes = await Promise.allSettled(routerChat.mock.results.map((result) => result.value));
    expect(outcomes.every((o) => o.status === "rejected" && o.reason instanceof ProviderTimeBudgetExceededError)).toBe(true);
    chat.mockReset().mockResolvedValue(answer("none"));

    const actual = await router.chat({ model: "standard-cheap", connection, messages: [{ role: "user", content: "next" }] });

    expect(actual).toMatchObject({ choices: [{ message: { content: "none" } }] });
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
