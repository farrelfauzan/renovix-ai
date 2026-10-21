import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolveLlmProvider } from "../../providers/llm-provider";
import { readProviderHttpError } from "../../providers/utils/read-provider-http-error";
import { readProviderJson } from "../../providers/utils/read-provider-json";
import { readPositiveInteger } from "../../../common/utils/read-positive-integer";
import { assertEmbeddingLength } from "../utils/assert-embedding-length";
import { fakeEmbedding } from "../utils/fake-embedding";
import { EMBEDDING_COLUMN_DIMENSIONS } from "../config/embedding-column-dimensions";

const DEFAULT_EMBEDDING_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-large-instruct";
const EMBEDDING_TIMEOUT_MS = 60000;

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly dimensions: number;
  /** LLM_PROVIDER=fake (RX-88): deterministic local vectors, no key, no network. */
  private readonly fake = resolveLlmProvider(process.env) === "fake";

  /** RX-160: EMBEDDING_* settings; unset, they are today's URL, model and key (OPENROUTER_API_KEY). */
  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.fake
      ? ""
      : this.configService.get<string>("EMBEDDING_API_KEY") ||
        this.configService.getOrThrow<string>("OPENROUTER_API_KEY");
    this.baseUrl =
      this.configService.get<string>("EMBEDDING_BASE_URL") || DEFAULT_EMBEDDING_BASE_URL;
    this.model = this.configService.get<string>("EMBEDDING_MODEL") || DEFAULT_EMBEDDING_MODEL;
    this.dimensions = readPositiveInteger({
      name: "EMBEDDING_DIMENSIONS",
      value: this.configService.get<string>("EMBEDDING_DIMENSIONS"),
      fallback: EMBEDDING_COLUMN_DIMENSIONS,
    });
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    if (this.fake) return texts.map(fakeEmbedding);

    // RX-161: Node's fetch, the same shape as the chat adapter.
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
    // RNX-190 (D197, D199): a typed error with a fixed text; neither the body nor a parse error quoting it goes on.
    if (!response.ok) throw await readProviderHttpError(response);

    const data: any = await readProviderJson(response);
    for (const item of data.data) {
      assertEmbeddingLength(item.embedding, EMBEDDING_COLUMN_DIMENSIONS);
    }

    return data.data.map((item: any) => ({
      embedding: item.embedding,
      tokenCount: data.usage?.total_tokens
        ? Math.ceil(data.usage.total_tokens / texts.length)
        : Math.ceil(texts[data.data.indexOf(item)]?.length / 4),
    }));
  }

  async embedSingle(text: string): Promise<EmbeddingResult> {
    const results = await this.embed([text]);
    return results[0];
  }
}
