import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { createHash } from "crypto";
import { resolveLlmProvider } from "../providers/llm-provider";

/** knowledge_chunks.embedding is vector(1024) (prisma/schema.prisma). */
const FAKE_EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string;
  private readonly baseUrl = "https://openrouter.ai/api/v1";
  private readonly model = "intfloat/multilingual-e5-large-instruct";
  /** LLM_PROVIDER=fake (RX-88): deterministic local vectors, no key, no network. */
  private readonly fake = resolveLlmProvider(process.env) === "fake";

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.fake
      ? ""
      : this.configService.getOrThrow<string>("OPENROUTER_API_KEY");
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    if (this.fake) return texts.map(fakeEmbedding);

    const response = await axios.post(
      `${this.baseUrl}/embeddings`,
      {
        model: this.model,
        input: texts,
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
  for (let block = 0; embedding.length < FAKE_EMBEDDING_DIMENSIONS; block++) {
    const digest = createHash("sha256").update(`${block}:${text}`).digest();
    for (const byte of digest) embedding.push(byte / 127.5 - 1);
  }
  return {
    embedding: embedding.slice(0, FAKE_EMBEDDING_DIMENSIONS),
    tokenCount: Math.ceil(text.length / 4),
  };
}
