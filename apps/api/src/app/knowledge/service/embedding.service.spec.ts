import { inspect } from "node:util";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmbeddingService } from "./embedding.service";
import { KnowledgeService } from "./knowledge.service";
import type { S3Service } from "./s3.service";
import type { KnowledgeBaseRepository } from "../repository/knowledge-base.repository";
import type { KnowledgeChunkRepository } from "../repository/knowledge-chunk.repository";
import { blockOutbound, OutboundBlocker, sendJson, startStubHttpServer, StubHttpServer } from "../../../../test/llm-stub";
import { captureOutput } from "../../../../test/capture-output";
import { plantedProviderSecret } from "../../../../test/planted-provider-secret";

// RX-160: embeddings read base URL, key, model and dimensions from configuration.
// Only a local stub is called; every other host is blocked (blockOutbound).

const EMBEDDING_KEY = "rx160-marker-key-not-real-embedding";
const OPENROUTER_KEY = "rx160-marker-key-not-real-openrouter";
const ENV_KEYS = [
  "LLM_PROVIDER",
  "OPENROUTER_API_KEY",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_API_KEY",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;

const savedEnv = ENV_KEYS.map((k) => process.env[k]);
let blocker: OutboundBlocker;
let stub: StubHttpServer;

const makeService = (env: Env): EmbeddingService => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  return new EmbeddingService(new ConfigService());
};

const vectors = (count: number, length: number) => ({
  data: Array.from({ length: count }, (_, i) => ({ embedding: Array(length).fill(i / 10) })),
  usage: { total_tokens: 8 },
});

const stubEnv = (): Env => ({
  EMBEDDING_BASE_URL: stub.baseUrl,
  EMBEDDING_API_KEY: EMBEDDING_KEY,
  EMBEDDING_MODEL: "rx160-embedding-model",
});

beforeAll(async () => {
  stub = await startStubHttpServer();
});

beforeEach(() => {
  blocker = blockOutbound();
  stub.requests.length = 0;
  stub.respond((req, res) => sendJson(res, 200, vectors(req.body.input.length, 1024)));
});

afterEach(() => {
  blocker.restore();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await stub.close();
  ENV_KEYS.forEach((k, i) => {
    if (savedEnv[i] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[i];
  });
});

describe("RX-160 AC5: EMBEDDING_* configuration", () => {
  it("EMBEDDING_* → the stub gets the configured model, key and dimensions: 1024", async () => {
    const result = await makeService(stubEnv()).embed(["a", "b"]);

    expect(result).toHaveLength(2);
    expect(result[0].embedding).toHaveLength(1024);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0].url).toBe("/v1/embeddings");
    expect(stub.requests[0].headers.authorization).toBe(`Bearer ${EMBEDDING_KEY}`);
    expect(stub.requests[0].body).toEqual({ model: "rx160-embedding-model", input: ["a", "b"], dimensions: 1024 });
    expect(blocker.blocked).toHaveLength(0);
  });

  it("control: EMBEDDING_* unset → today's URL, model and key", async () => {
    await expect(makeService({ OPENROUTER_API_KEY: OPENROUTER_KEY }).embed(["a"])).rejects.toThrow(
      /outbound call to openrouter.ai blocked/,
    );

    expect(blocker.blocked).toHaveLength(1);
    const sent = blocker.blocked[0];
    expect(sent.url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(sent.headers.Authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(JSON.parse(sent.body as string).model).toBe("intfloat/multilingual-e5-large-instruct");
  });

  it("no key at all → construction fails as today", () => {
    expect(() => makeService({ EMBEDDING_BASE_URL: stub.baseUrl })).toThrow(/OPENROUTER_API_KEY/);
  });

  it("negative: EMBEDDING_DIMENSIONS that is not a positive integer is refused at construction", () => {
    expect(() => makeService({ ...stubEnv(), EMBEDDING_DIMENSIONS: "-5" })).toThrow(/EMBEDDING_DIMENSIONS/);
  });
});

describe("RX-160 AC6: a vector that does not fit the vector(1024) column", () => {
  it("negative: a 768-long vector is refused, naming both lengths, before anything is returned to a writer", async () => {
    stub.respond((req, res) => sendJson(res, 200, vectors(req.body.input.length, 768)));

    await expect(makeService(stubEnv()).embed(["a"])).rejects.toThrow(/768.*1024|1024.*768/);
  });

  it("negative: one bad vector in a batch fails the whole batch", async () => {
    stub.respond((_req, res) =>
      sendJson(res, 200, { data: [{ embedding: Array(1024).fill(0) }, { embedding: Array(1536).fill(0) }] }),
    );

    await expect(makeService(stubEnv()).embed(["a", "b"])).rejects.toThrow(/1536/);
  });
});

describe("RNX-27: the provider's dimensions parameter, no local trim or pad, and the model name", () => {
  const largeModelEnv = (): Env => ({ ...stubEnv(), EMBEDDING_MODEL: "text-embedding-3-large", EMBEDDING_DIMENSIONS: "1024" });

  it("text-embedding-3-large at 1024: the request carries dimensions 1024 and the vector comes back exactly as answered", async () => {
    const answered = Array.from({ length: 1024 }, (_, i) => i / 1024);
    stub.respond((_req, res) => sendJson(res, 200, { data: [{ embedding: answered }], usage: { total_tokens: 2 } }));

    const [actual] = await makeService(largeModelEnv()).embed(["a"]);

    expect(stub.requests[0].body).toEqual({ model: "text-embedding-3-large", input: ["a"], dimensions: 1024 });
    expect(actual.embedding).toEqual(answered);
  });

  it("modelName is the configured model, and \"fake\" in LLM_PROVIDER=fake", () => {
    expect(makeService(largeModelEnv()).modelName).toBe("text-embedding-3-large");
    expect(makeService({ LLM_PROVIDER: "fake" }).modelName).toBe("fake");
  });

  it.each([768, 1025])(
    "negative: a %i-long answer is refused (not trimmed or padded) before the write path inserts anything",
    async (length) => {
      stub.respond((req, res) => sendJson(res, 200, vectors(req.body.input.length, length)));
      const insertChunks = jest.fn();
      const knowledge = new KnowledgeService(
        makeService(largeModelEnv()),
        {} as S3Service,
        { findKnowledgeBaseWithChunkCount: async () => ({ id: "kb-1", userId: "user-1", workspaceId: null }) } as unknown as KnowledgeBaseRepository,
        { insertChunks } as unknown as KnowledgeChunkRepository,
      );

      await expect(knowledge.addChunks("user-1", "kb-1", [{ content: "a" }])).rejects.toThrow(new RegExp(`${length}`));

      expect(insertChunks).not.toHaveBeenCalled();
    },
  );
});

describe("RX-160 AC7: the embedding key never reaches a log line", () => {
  it("negative: no Logger or console output carries a key", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    for (const m of ["log", "warn", "error", "debug", "verbose"] as const) jest.spyOn(Logger.prototype, m).mockImplementation(capture);
    for (const m of ["log", "warn", "error", "info", "debug"] as const) jest.spyOn(console, m).mockImplementation(capture);
    stub.respond((_req, res) => sendJson(res, 500, { error: "boom" }));
    const service = makeService(stubEnv());

    await expect(service.embed(["a"])).rejects.toThrow();
    stub.respond((req, res) => sendJson(res, 200, vectors(req.body.input.length, 3)));
    await expect(service.embed(["a"])).rejects.toThrow();

    expect(lines.filter((l) => l.includes("rx160-marker-key"))).toEqual([]);
  });
});

// RNX-190 (D197, D208): a provider 401 body can echo the key's last characters and its SHA-256 (RX-174). The error an
// embedding call rejects with must not carry them: not in a log line written meanwhile (Nest's Logger is not mocked),
// and not in the error itself as a log would print it (util.inspect, as Nest's ExceptionsHandler logs an error a
// route did not catch), as JSON, as a string or as its stack.
describe("RNX-190 AC1: an embedding call answered 401 with a planted key suffix and SHA-256", () => {
  const leaksOf = (err: unknown, lines: string[]): string[] =>
    [inspect(err), JSON.stringify(err), String(err), (err as Error).stack ?? "", ...lines].filter(plantedProviderSecret.isFoundIn);

  it("control: the stub's answer carries both planted values, and the search finds them there", async () => {
    stub.respond((_req, res) => sendJson(res, 401, plantedProviderSecret.body));

    const answer = await fetch(`${stub.baseUrl}/embeddings`, { method: "POST", body: "{}" });

    expect([answer.status, plantedProviderSecret.isFoundIn(await answer.text())]).toEqual([401, true]);
  });

  it("the 401 surfaces with its typed fixed text; neither value is in a log line or in the error", async () => {
    stub.respond((_req, res) => sendJson(res, 401, plantedProviderSecret.body));
    const output = captureOutput();

    const thrown = await makeService(stubEnv()).embed(["a"]).catch((err: unknown) => err);

    expect({ status: (thrown as { status?: number }).status, leaks: leaksOf(thrown, output.lines) }).toEqual({ status: 401, leaks: [] });
    expect(thrown).toMatchObject({ name: "ProviderHttpError", kind: "unauthorized", message: "Provider rejected the credentials (401)" });
  });

  it("a 2xx answer that is not JSON fails with a fixed text, never the parse error (it quotes the body)", async () => {
    stub.respond((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`sk-...${plantedProviderSecret.keySuffix} not json`);
    });

    const thrown = await makeService(stubEnv()).embed(["a"]).catch((err: unknown) => err);

    expect({ message: (thrown as Error).message, leaks: [inspect(thrown)].filter(plantedProviderSecret.isFoundIn) }).toEqual({
      message: "The provider answered with something other than JSON",
      leaks: [],
    });
  });
});
