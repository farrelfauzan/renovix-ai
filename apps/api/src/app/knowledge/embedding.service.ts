import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string;
  private readonly baseUrl = "https://openrouter.ai/api/v1";
  private readonly modelCandidates: string[];
  private readonly targetDimensions: number;
  private activeModel: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.getOrThrow<string>("OPENROUTER_API_KEY");

    const configuredList =
      this.configService.get<string>("OPENROUTER_EMBEDDING_MODELS") ||
      this.configService.get<string>("OPENROUTER_EMBEDDING_MODEL") ||
      "openai/text-embedding-3-small";

    this.modelCandidates = configuredList
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    const configuredDimensions = Number(
      this.configService.get<string>("OPENROUTER_EMBEDDING_DIMENSIONS") ||
        "1024",
    );
    this.targetDimensions =
      Number.isFinite(configuredDimensions) && configuredDimensions > 0
        ? Math.floor(configuredDimensions)
        : 1024;

    this.activeModel =
      this.modelCandidates[0] || "openai/text-embedding-3-small";

    this.logger.log(
      `Embedding model candidates: ${this.modelCandidates.join(", ")}`,
    );
    this.logger.log(`Embedding dimensions: ${this.targetDimensions}`);
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    const response = await this.requestEmbeddings(texts);

    const data = response.data;

    return data.data.map((item: any) => ({
      embedding: this.normalizeEmbedding(item.embedding),
      tokenCount: data.usage?.total_tokens
        ? Math.ceil(data.usage.total_tokens / texts.length)
        : Math.ceil(texts[data.data.indexOf(item)]?.length / 4),
    }));
  }

  async embedSingle(text: string): Promise<EmbeddingResult> {
    const results = await this.embed([text]);
    return results[0];
  }

  private async requestEmbeddings(texts: string[]) {
    let lastError: any;

    const orderedCandidates = [
      this.activeModel,
      ...this.modelCandidates.filter((m) => m !== this.activeModel),
    ];

    for (const model of orderedCandidates) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/embeddings`,
          {
            model,
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

        if (this.activeModel !== model) {
          this.logger.warn(
            `Switched embedding model to ${model} after previous failures`,
          );
        }
        this.activeModel = model;
        return response;
      } catch (error: any) {
        lastError = error;
        if (!this.isRetryableModelError(error)) {
          throw error;
        }

        this.logger.warn(
          `Embedding model \"${model}\" unavailable, trying next candidate`,
        );
      }
    }

    throw lastError;
  }

  private isRetryableModelError(error: any): boolean {
    const status = error?.response?.status;
    const data = error?.response?.data;

    if (status !== 400) return false;

    const rawMessage =
      (typeof data === "string"
        ? data
        : data?.error?.message || data?.message || "") || "";
    const message = String(rawMessage).toLowerCase();

    return (
      message.includes("does not exist") ||
      message.includes("not found") ||
      message.includes("no endpoints found") ||
      message.includes("unknown model")
    );
  }

  private normalizeEmbedding(embedding: number[]): number[] {
    if (!Array.isArray(embedding)) {
      return new Array(this.targetDimensions).fill(0);
    }

    if (embedding.length === this.targetDimensions) {
      return embedding;
    }

    if (embedding.length > this.targetDimensions) {
      this.logger.warn(
        `Embedding dimension mismatch: got ${embedding.length}, truncating to ${this.targetDimensions}`,
      );
      return embedding.slice(0, this.targetDimensions);
    }

    this.logger.warn(
      `Embedding dimension mismatch: got ${embedding.length}, padding to ${this.targetDimensions}`,
    );
    return [
      ...embedding,
      ...new Array(this.targetDimensions - embedding.length).fill(0),
    ];
  }
}
