import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { createHash } from "crypto";
import { resolveLlmProvider } from "../../providers/llm-provider";
import { readPositiveInteger } from "../../../common/utils/read-positive-integer";
import { assertEmbeddingLength } from "../utils/assert-embedding-length";

/** knowledge_chunks.embedding is vector(1024) (prisma/schema.prisma). */
const EMBEDDING_COLUMN_DIMENSIONS = 1024;
const DEFAULT_EMBEDDING_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-large-instruct";

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

    const response = await axios.post(
      `${this.baseUrl}/embeddings`,
      {
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );

    const data = response.data;
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

/** Same text, same vector; values in [-1, 1] from SHA-256 of the text. */
function fakeEmbedding(text: string): EmbeddingResult {
  const embedding: number[] = [];
  for (let block = 0; embedding.length < EMBEDDING_COLUMN_DIMENSIONS; block++) {
    const digest = createHash("sha256").update(`${block}:${text}`).digest();
    for (const byte of digest) embedding.push(byte / 127.5 - 1);
  }
  return {
    embedding: embedding.slice(0, EMBEDDING_COLUMN_DIMENSIONS),
    tokenCount: Math.ceil(text.length / 4),
  };
}
