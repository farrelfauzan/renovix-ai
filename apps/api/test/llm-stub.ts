import axios, { AxiosAdapter } from "axios";
import { createServer, IncomingHttpHeaders, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

// RX-160: a local stand-in for an LLM / embedding provider, and a blocker that
// keeps every other outbound call off the network. Tests never reach a real
// provider: only 127.0.0.1 is let through.

export interface StubRequest {
  url: string;
  headers: IncomingHttpHeaders;
  body: any;
}

export type StubHandler = (req: StubRequest, res: ServerResponse) => void;

export interface StubHttpServer {
  /** e.g. http://127.0.0.1:54321/v1 */
  baseUrl: string;
  requests: StubRequest[];
  /** Handler for the following requests (default: 500). */
  respond(handler: StubHandler): void;
  close(): Promise<void>;
}

export const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

/** A chat completion as the provider answers it. */
export const chatCompletion = (content: string) => ({
  id: "gen-stub",
  choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
});

/** An SSE stream: one `data:` line per payload, then [DONE]. */
export const sendSse = (res: ServerResponse, payloads: string[]): void => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const p of payloads) res.write(`data: ${p}\n\n`);
  res.end("data: [DONE]\n\n");
};

export async function startStubHttpServer(): Promise<StubHttpServer> {
  const requests: StubRequest[] = [];
  let handler: StubHandler = (_req, res) => sendJson(res, 500, { error: "no handler" });
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const recorded = { url: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    respond: (h) => (handler = h),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const LLM_ENV_KEYS = [
  "LLM_PROVIDER",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_FALLBACK_BASE_URL",
  "LLM_FALLBACK_API_KEY",
] as const;

/**
 * RX-169: points the real adapter's env variables at the stubs (an adapter built after this call,
 * e.g. by ProvidersModule, reads them). RX-178: chat calls go to the request's connection (the model's
 * provider record), so only GET /models uses LLM_BASE_URL / LLM_API_KEY; the fallback variables are set
 * only so a test can show that nothing is sent there. Returns a function that restores them.
 */
export function pointLlmAtStubs(params: {
  primary: StubHttpServer;
  apiKey: string;
  fallback?: StubHttpServer;
  fallbackApiKey?: string;
}): () => void {
  const saved = LLM_ENV_KEYS.map((k) => process.env[k]);
  LLM_ENV_KEYS.forEach((k) => delete process.env[k]);
  process.env.LLM_BASE_URL = params.primary.baseUrl;
  process.env.LLM_API_KEY = params.apiKey;
  if (params.fallback && params.fallbackApiKey) {
    process.env.LLM_FALLBACK_BASE_URL = params.fallback.baseUrl;
    process.env.LLM_FALLBACK_API_KEY = params.fallbackApiKey;
  }
  return () =>
    LLM_ENV_KEYS.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
}

/** An outbound request the blocker kept off the network (RX-161: fetch or axios). */
export interface BlockedRequest {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface OutboundBlocker {
  /** Every fetch or axios request to a host other than 127.0.0.1, never sent. */
  blocked: BlockedRequest[];
  restore(): void;
}

/**
 * Lets fetch and axios reach 127.0.0.1 only. Any other request is recorded and
 * rejected without touching the network; https.request throws.
 */
export function blockOutbound(): OutboundBlocker {
  const blocked: BlockedRequest[] = [];
  const refuse = (request: BlockedRequest) => {
    blocked.push(request);
    return Promise.reject(new Error(`RX-160 test: outbound call to ${new URL(request.url).hostname} blocked`));
  };
  const savedAdapter = axios.defaults.adapter;
  const httpAdapter = axios.getAdapter("http");
  const guard: AxiosAdapter = (config) => {
    const url = new URL(config.url ?? "", config.baseURL);
    if (url.hostname === "127.0.0.1") return httpAdapter(config);
    return refuse({ url: url.href, headers: { ...config.headers } as Record<string, string>, body: config.data });
  };
  axios.defaults.adapter = guard;
  const https: typeof import("node:https") = require("node:https");
  const httpsSpy = jest.spyOn(https, "request").mockImplementation(() => {
    throw new Error("RX-160 test: outbound https.request blocked");
  });
  const realFetch = globalThis.fetch;
  const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (new URL(url).hostname === "127.0.0.1") return realFetch(input, init);
    return refuse({ url, headers: init?.headers as Record<string, string>, body: init?.body as string });
  });
  return {
    blocked,
    restore: () => {
      axios.defaults.adapter = savedAdapter;
      httpsSpy.mockRestore();
      fetchSpy.mockRestore();
    },
  };
}
