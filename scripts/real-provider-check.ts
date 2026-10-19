// RX-174: real-provider check for RX-160 (request shape, model ids, the statuses that fire the fallback).
// Run by hand from the repo root, never in CI; Bun loads the provider keys from .env:
//   bun scripts/real-provider-check.ts [all|embeddings|models|wrong-key|proxy]
// It sends real, billed requests (a few dozen tokens each) and prints statuses, provider hosts and
// vector lengths. Every printed line goes through redact(): no key, no request header is printed.
// The "embeddings" section drives the real write path (KnowledgeService.addChunks) only when
// CHECK_DATABASE_URL names a local database whose name ends in "_test"; nothing else is written.
// The "proxy" section points the primary at a local stub (127.0.0.1) that only answers statuses and
// forwards nothing; the primary key is replaced by a placeholder there, the fallback is the real one.
import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { OpenRouterAdapter } from "../apps/api/src/app/providers/openrouter.adapter";
import { ProviderHttpError } from "../apps/api/src/app/providers/errors/provider-http-error";
import { parseModelIdMap } from "../apps/api/src/app/providers/utils/parse-model-id-map";
import type { ChatResponse } from "../apps/api/src/app/providers/provider.interface";
import { EmbeddingService } from "../apps/api/src/app/knowledge/service/embedding.service";
import { KnowledgeService } from "../apps/api/src/app/knowledge/service/knowledge.service";
import { KnowledgeBaseRepository } from "../apps/api/src/app/knowledge/repository/knowledge-base.repository";
import { KnowledgeChunkRepository } from "../apps/api/src/app/knowledge/repository/knowledge-chunk.repository";
import type { S3Service } from "../apps/api/src/app/knowledge/service/s3.service";
import type { PrismaService } from "../apps/api/src/app/prisma/prisma.service";

type Endpoint = { readonly label: string; readonly baseUrl: string; readonly apiKey: string };
type Usage = { prompt: number; completion: number };

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
const MIN_SECRET_LENGTH = 6;
const EXCERPT_LENGTH = 200;
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const WRONG_KEY = "sk-renovix-wrong-key-000";
const STUB_KEY = "renovix-stub-primary-placeholder";
const NOT_A_MODEL = "renovix/not-a-model";
const PROMPT = "Reply with the single word: ok";
const MAX_TOKENS = 16;
const DIRECT_TIMEOUT_MS = 60000;
const FALLBACK_LOG_LINE = "sending the request once to the fallback";
const EMBED_TEXTS = ["Renovix check one.", "Renovix check two."];

const secretValues = Object.entries(process.env)
  .filter(([name, value]) => SECRET_NAME.test(name) && (value?.length ?? 0) >= MIN_SECRET_LENGTH)
  .map(([, value]) => value as string)
  .sort((a, b) => b.length - a.length);

/** Replaces every secret env value and any bearer credential with [redacted]. */
const redact = (text: string): string =>
  secretValues
    .reduce((acc, value) => acc.split(value).join("[redacted]"), text)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");

/** The only way this script prints. */
const say = (line: string): void => console.log(redact(line));

/** Redacted first, then cut, so a cut never leaves part of a key. */
const excerpt = (text: string): string => redact(text).replace(/\s+/g, " ").slice(0, EXCERPT_LENGTH);

const describeError = (err: unknown): string =>
  err instanceof ProviderHttpError
    ? `${err.name} ${err.status}: ${excerpt(err.bodyText)}`
    : `${(err as Error)?.name ?? "Error"}: ${excerpt(String((err as Error)?.message ?? err))}`;

const hostOf = (url: string): string => new URL(url).host;

// ─── Request count per host (every real request goes through fetch) ───
const realFetch = globalThis.fetch;
const requestCount = new Map<string, number>();
const usageByHost = new Map<string, Usage>();
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = hostOf(url);
  requestCount.set(host, (requestCount.get(host) ?? 0) + 1);
  return realFetch(input, init);
}) as typeof fetch;

const countFor = (host: string): number => requestCount.get(host) ?? 0;

const addUsage = (host: string, prompt = 0, completion = 0): void => {
  const usage = usageByHost.get(host) ?? { prompt: 0, completion: 0 };
  usageByHost.set(host, { prompt: usage.prompt + prompt, completion: usage.completion + completion });
};

// ─── Captured Nest logger output (adapter and embedding service) ───
const logLines: string[] = [];
const capture =
  (level: string) =>
  (message: unknown): void => {
    const line = `[${level}] ${String(message)}`;
    logLines.push(line);
    say(`      log ${line}`);
  };
Logger.overrideLogger({
  log: capture("log"),
  error: capture("error"),
  warn: capture("warn"),
  debug: capture("debug"),
  verbose: capture("verbose"),
  fatal: capture("fatal"),
});

/** A ConfigService stand-in: process.env, with `overrides` (undefined = unset) on top. */
const configFrom = (overrides: Record<string, string | undefined> = {}): ConfigService => {
  const read = (name: string): string | undefined =>
    (Object.hasOwn(overrides, name) ? overrides[name] : process.env[name]) || undefined;
  return {
    get: read,
    getOrThrow: (name: string) => {
      const value = read(name);
      if (value === undefined) throw new Error(`${name} is not set`);
      return value;
    },
  } as unknown as ConfigService;
};

const primaryEndpoint = (): Endpoint | undefined => {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
  return apiKey ? { label: "primary", baseUrl: process.env.LLM_BASE_URL || DEFAULT_BASE_URL, apiKey } : undefined;
};

const fallbackEndpoint = (): Endpoint | undefined => {
  const { LLM_FALLBACK_BASE_URL: baseUrl, LLM_FALLBACK_API_KEY: apiKey } = process.env;
  return baseUrl && apiKey ? { label: "fallback", baseUrl, apiKey } : undefined;
};

const modelIdMap = parseModelIdMap(process.env.LLM_MODEL_ID_MAP);
/** Our model id used for the adapter checks: CHECK_MODEL_ID, else the first LLM_MODEL_ID_MAP key. */
const adapterModelId = process.env.CHECK_MODEL_ID || [...modelIdMap.keys()][0];

const heading = (title: string): void => say(`\n=== ${title} ===`);

// ─── a/b. Embeddings ───

/** Builds the real KnowledgeService on a throwaway test database (refuses anything else). */
function openWritePath(url: string): { prisma: PrismaClient; build: (embedding: EmbeddingService) => KnowledgeService } {
  const parsed = new URL(url);
  const isLocal = ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (!isLocal || !parsed.pathname.endsWith("_test")) {
    throw new Error("CHECK_DATABASE_URL must be a local database whose name ends in _test");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const db = prisma as unknown as PrismaService;
  const build = (embedding: EmbeddingService): KnowledgeService =>
    new KnowledgeService(embedding, {} as S3Service, new KnowledgeBaseRepository(db), new KnowledgeChunkRepository(db));
  return { prisma, build };
}

async function embedAndReport(label: string, service: EmbeddingService, host: string): Promise<void> {
  const before = countFor(host);
  try {
    const results = await service.embed(EMBED_TEXTS);
    addUsage(host, results.reduce((sum, r) => sum + r.tokenCount, 0));
    say(`  ${label}: 200, ${results.length} vectors, lengths ${results.map((r) => r.embedding.length).join(", ")} (requests ${countFor(host) - before})`);
  } catch (err) {
    say(`  ${label}: threw ${describeError(err)} (requests ${countFor(host) - before})`);
  }
}

async function addChunksAndCount(label: string, service: KnowledgeService, prisma: PrismaClient, ids: { userId: string; kbId: string }): Promise<void> {
  const before = await prisma.knowledgeChunk.count();
  try {
    const result = await service.addChunks(ids.userId, ids.kbId, EMBED_TEXTS.map((content) => ({ content })));
    say(`  ${label}: addChunks returned inserted=${result.inserted}`);
  } catch (err) {
    say(`  ${label}: addChunks threw ${describeError(err)}`);
  }
  say(`  ${label}: knowledge_chunks rows before ${before}, after ${await prisma.knowledgeChunk.count()}`);
}

async function checkEmbeddings(): Promise<void> {
  heading("a/b. Embeddings (EmbeddingService.embed, real request)");
  if (!process.env.EMBEDDING_API_KEY && !process.env.OPENROUTER_API_KEY) {
    say("  skipped: neither EMBEDDING_API_KEY nor OPENROUTER_API_KEY is set");
    return;
  }
  const host = hostOf(process.env.EMBEDDING_BASE_URL || DEFAULT_BASE_URL);
  say(`  host ${host}, EMBEDDING_MODEL ${process.env.EMBEDDING_MODEL || "(default)"}`);
  const embedding1024 = new EmbeddingService(configFrom({ EMBEDDING_DIMENSIONS: "1024" }));
  const embedding768 = new EmbeddingService(configFrom({ EMBEDDING_DIMENSIONS: "768" }));
  await embedAndReport("a. EMBEDDING_DIMENSIONS=1024", embedding1024, host);
  const embeddingEndpoint = {
    label: "embedding",
    baseUrl: process.env.EMBEDDING_BASE_URL || DEFAULT_BASE_URL,
    apiKey: (process.env.EMBEDDING_API_KEY || process.env.OPENROUTER_API_KEY) as string,
  };
  await listMatchingModels(embeddingEndpoint, ["embed", "e5"]);
  const databaseUrl = process.env.CHECK_DATABASE_URL;
  if (!databaseUrl) {
    say("  b. CHECK_DATABASE_URL not set: write path not run, embed() only");
    await embedAndReport("b. EMBEDDING_DIMENSIONS=768", embedding768, host);
    return;
  }
  const { prisma, build } = openWritePath(databaseUrl);
  try {
    const user = await prisma.user.create({ data: { email: `rx-174-${Date.now()}@test.local` } });
    const kb = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "rx-174 check" } });
    const ids = { userId: user.id, kbId: kb.id };
    await addChunksAndCount("b. EMBEDDING_DIMENSIONS=768 (KnowledgeService.addChunks)", build(embedding768), prisma, ids);
    await addChunksAndCount("b. control, EMBEDDING_DIMENSIONS=1024 (the count can move)", build(embedding1024), prisma, ids);
  } finally {
    await prisma.$disconnect();
  }
}

// ─── c. Model ids, directly to each endpoint ───

/** The adapter's chat body (model, messages, temperature, max_tokens), sent once with no retry. */
async function sendDirect(endpoint: Endpoint, model: string, apiKey = endpoint.apiKey): Promise<{ status: number; note: string }> {
  const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT }], temperature: 0.7, max_tokens: MAX_TOKENS }),
    signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) return { status: response.status, note: excerpt(text) };
  const data = JSON.parse(text);
  addUsage(hostOf(endpoint.baseUrl), data.usage?.prompt_tokens, data.usage?.completion_tokens);
  const choice = data.choices?.[0];
  return {
    status: response.status,
    note: `answer "${excerpt(choice?.message?.content ?? "")}", finish_reason ${choice?.finish_reason}, model ${data.model}, usage ${data.usage?.prompt_tokens}/${data.usage?.completion_tokens}`,
  };
}

async function sendDirectSafely(endpoint: Endpoint | undefined, model: string): Promise<{ status: string; note: string }> {
  if (!endpoint) return { status: "not configured", note: "" };
  try {
    const { status, note } = await sendDirect(endpoint, model);
    return { status: String(status), note };
  } catch (err) {
    return { status: "error", note: describeError(err) };
  }
}

/** GET /models through the real adapter; prints the listed ids that contain one of `words`. */
async function listMatchingModels(endpoint: Endpoint, words: string[]): Promise<void> {
  const adapter = new OpenRouterAdapter(
    configFrom({ LLM_BASE_URL: endpoint.baseUrl, LLM_API_KEY: endpoint.apiKey, LLM_FALLBACK_BASE_URL: undefined }),
  );
  try {
    const models = await adapter.listModels();
    const matches = models.filter((m) => words.some((w) => m.providerId.replace(/\./g, "-").includes(w)));
    say(`  ${endpoint.label} (${hostOf(endpoint.baseUrl)}) GET /models: ${models.length} ids; matching ${words.join(", ")}:`);
    matches.forEach((m) => say(`    ${m.providerId}  input ${m.inputPrice ?? "-"}  output ${m.outputPrice ?? "-"}`));
  } catch (err) {
    say(`  ${endpoint.label} GET /models: ${describeError(err)}`);
  }
}

async function checkModels(): Promise<void> {
  heading("c. LLM_MODEL_ID_MAP ids, one request each, directly to the primary and the fallback");
  const primary = primaryEndpoint();
  const fallback = fallbackEndpoint();
  say(`  primary ${primary ? hostOf(primary.baseUrl) : "not configured (no LLM_API_KEY / OPENROUTER_API_KEY)"}`);
  say(`  fallback ${fallback ? hostOf(fallback.baseUrl) : "not configured (no LLM_FALLBACK_BASE_URL + LLM_FALLBACK_API_KEY)"}`);
  const rows = [
    ...[...new Set(modelIdMap.values())].map((id) => ({ id, kind: "map value (sent)" })),
    ...[...modelIdMap.keys()].map((id) => ({ id, kind: "map key (never sent)" })),
    { id: NOT_A_MODEL, kind: "negative control" },
  ];
  say("  id | kind | primary status | fallback status | primary note | fallback note");
  for (const row of rows) {
    const onPrimary = await sendDirectSafely(primary, row.id);
    const onFallback = await sendDirectSafely(fallback, row.id);
    say(`  ${row.id} | ${row.kind} | ${onPrimary.status} | ${onFallback.status} | ${onPrimary.note} | ${onFallback.note}`);
  }
  const ids = rows.filter((row) => row.id !== NOT_A_MODEL).map((row) => row.id);
  const words = [...new Set(ids.map((id) => (id.split("/").pop() ?? id).split(/[-.]/).slice(0, 2).join("-")))];
  for (const endpoint of [primary, fallback]) if (endpoint) await listMatchingModels(endpoint, words);
}

// ─── d. Wrong key ───

async function checkWrongKey(): Promise<void> {
  heading(`d. Wrong key (${WRONG_KEY}) through the real adapter`);
  const primary = primaryEndpoint();
  const fallback = fallbackEndpoint();
  if (!primary || !adapterModelId) {
    say("  skipped: no primary key or no model id (LLM_MODEL_ID_MAP / CHECK_MODEL_ID)");
    return;
  }
  const adapter = new OpenRouterAdapter(configFrom({ LLM_API_KEY: WRONG_KEY, OPENROUTER_API_KEY: undefined }));
  const fallbackHost = fallback ? hostOf(fallback.baseUrl) : "";
  const fallbackBefore = countFor(fallbackHost);
  logLines.length = 0;
  try {
    await adapter.chat({ model: adapterModelId, providerId: adapterModelId, messages: [{ role: "user", content: PROMPT }], max_tokens: MAX_TOKENS });
    say("  adapter: unexpected success");
  } catch (err) {
    say(`  adapter, primary ${hostOf(primary.baseUrl)}: ${describeError(err)}`);
  }
  say(`  fallback configured: ${Boolean(fallback)}; requests to the fallback: ${countFor(fallbackHost) - fallbackBefore}; "${FALLBACK_LOG_LINE}" logged: ${logLines.some((l) => l.includes(FALLBACK_LOG_LINE))}`);
  if (!fallback) return;
  const direct = await sendDirect(fallback, modelIdMap.get(adapterModelId) ?? adapterModelId, WRONG_KEY);
  say(`  direct, fallback ${fallbackHost} with the wrong key: ${direct.status} ${direct.note}`);
}

// ─── e. Local stub as the primary ───

type Stub = { url: string; status: number; calls: number; close: () => Promise<void> };

/** A local primary that answers `status` to everything, counts calls and forwards nothing. */
async function startStub(): Promise<Stub> {
  const stub = { status: 503, calls: 0 } as Stub;
  const server = http.createServer((req, res) => {
    req.resume();
    stub.calls += 1;
    res.writeHead(stub.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `stub primary answered ${stub.status}` } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  stub.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return stub;
}

/** The adapter's back-off waits (>= 1 s) run in 1 ms; the requested waits are recorded. */
function compressWaits(): { waits: number[]; restore: () => void } {
  const realSetTimeout = globalThis.setTimeout;
  const waits: number[] = [];
  globalThis.setTimeout = ((handler: () => void, ms?: number, ...args: unknown[]) => {
    if ((ms ?? 0) < 1000) return realSetTimeout(handler, ms, ...args);
    waits.push(ms as number);
    return realSetTimeout(handler, 1, ...args);
  }) as typeof setTimeout;
  return { waits, restore: () => (globalThis.setTimeout = realSetTimeout) };
}

async function runAgainstPrimary(label: string, baseUrl: string, stub?: Stub): Promise<void> {
  const fallback = fallbackEndpoint() as Endpoint;
  const fallbackHost = hostOf(fallback.baseUrl);
  const adapter = new OpenRouterAdapter(configFrom({ LLM_BASE_URL: baseUrl, LLM_API_KEY: STUB_KEY, OPENROUTER_API_KEY: undefined }));
  const fallbackBefore = countFor(fallbackHost);
  const timer = compressWaits();
  logLines.length = 0;
  if (stub) stub.calls = 0;
  let outcome: string;
  try {
    const response: ChatResponse = await adapter.chat({ model: adapterModelId, providerId: adapterModelId, messages: [{ role: "user", content: PROMPT }], max_tokens: MAX_TOKENS });
    addUsage(fallbackHost, response.usage.prompt_tokens, response.usage.completion_tokens);
    outcome = `answer reached the caller: "${excerpt(response.choices[0]?.message?.content ?? "")}" (usage ${response.usage.prompt_tokens}/${response.usage.completion_tokens})`;
  } catch (err) {
    outcome = `error reached the caller: ${describeError(err)}`;
  } finally {
    timer.restore();
  }
  const fallbackLines = logLines.filter((l) => l.includes(FALLBACK_LOG_LINE)).length;
  say(`  ${label}: primary calls ${stub ? stub.calls : "n/a"}, back-off waits [${timer.waits.join(", ")}] ms (run in 1 ms), fallback requests ${countFor(fallbackHost) - fallbackBefore}, fallback log lines ${fallbackLines}`);
  say(`    ${outcome}`);
}

async function checkProxy(): Promise<void> {
  heading("e. Local stub as LLM_BASE_URL (real adapter, real fallback)");
  const fallback = fallbackEndpoint();
  if (!fallback || !adapterModelId) {
    say("  skipped: no fallback configured or no model id (LLM_MODEL_ID_MAP / CHECK_MODEL_ID)");
    return;
  }
  say(`  model ${adapterModelId} (sent as ${modelIdMap.get(adapterModelId) ?? adapterModelId}), fallback ${hostOf(fallback.baseUrl)}`);
  const stub = await startStub();
  try {
    for (const status of [503, 502, 500, 504, 429]) {
      stub.status = status;
      await runAgainstPrimary(`stub primary ${status}`, stub.url, stub);
    }
  } finally {
    await stub.close();
  }
  const closed = await startStub();
  await closed.close();
  await runAgainstPrimary("connection refused (closed port)", closed.url);
}

// ─── Main ───

const SECTIONS: Record<string, () => Promise<void>> = {
  embeddings: checkEmbeddings,
  models: checkModels,
  "wrong-key": checkWrongKey,
  proxy: checkProxy,
};

async function main(): Promise<void> {
  const chosen = process.argv[2] ?? "all";
  const names = chosen === "all" ? Object.keys(SECTIONS) : [chosen];
  if (!names.every((name) => SECTIONS[name])) throw new Error(`Unknown section "${chosen}"; use all, ${Object.keys(SECTIONS).join(", ")}`);
  say(`RX-174 real-provider check, ${new Date().toISOString()}, sections: ${names.join(", ")}`);
  for (const name of names) {
    try {
      await SECTIONS[name]();
    } catch (err) {
      say(`  section ${name} failed: ${describeError(err)}`);
    }
  }
  heading("f. Requests per host (every request this run sent)");
  for (const [host, count] of requestCount) {
    const usage = usageByHost.get(host);
    say(`  ${host}: ${count} requests${usage ? `, tokens reported: prompt ${usage.prompt}, completion ${usage.completion}` : ""}`);
  }
}

process.on("unhandledRejection", (err) => say(`unhandled rejection: ${describeError(err)}`));
main().catch((err) => {
  say(`failed: ${describeError(err)}`);
  process.exitCode = 1;
});
