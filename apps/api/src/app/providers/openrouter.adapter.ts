import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import {
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
} from "./provider.interface";

@Injectable()
export class OpenRouterAdapter implements ProviderAdapter {
  private readonly logger = new Logger(OpenRouterAdapter.name);
  private readonly apiKey: string;
  private readonly appTitle: string;
  private readonly appUrl: string;
  private readonly baseUrl = "https://openrouter.ai/api/v1";

  // Models that support reasoning_effort parameter
  private readonly modelsWithReasoningSupport = [
    "deepseek/deepseek-v4-pro",
    "qwen/qwen3.7-max",
    "qwen/qwen3.5-397b",
    "x-ai/grok-4.3",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.7",
    "anthropic/claude-opus-4.8",
    "anthropic/claude-opus-5.5",
  ];

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.getOrThrow<string>("OPENROUTER_API_KEY");
    this.appTitle =
      this.configService.get<string>("OPENROUTER_APP_TITLE") || "Renovix AI";
    this.appUrl =
      this.configService.get<string>("OPENROUTER_APP_URL") ||
      "https://chat.renovix.id";
  }

  private supportsReasoning(modelId: string): boolean {
    return this.modelsWithReasoningSupport.some((model) =>
      modelId.includes(model.split("/")[1] || model),
    );
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: params.providerId,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 4096,
    };

    if (this.supportsReasoning(params.providerId) && params.reasoning_effort) {
      body.reasoning_effort = params.reasoning_effort;
    }

    if (params.response_format) {
      body.response_format = params.response_format;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = params.tool_choice ?? "auto";
    }

    const maxRetries = 6;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/chat/completions`,
          body,
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": this.appUrl,
              "X-Title": this.appTitle,
            },
            timeout: 300000,
          },
        );

        const data = response.data;

        if (params.max_tokens && params.max_tokens <= 50) {
          this.logger.log(
            `[debug] raw choice: ${JSON.stringify(data.choices?.[0]?.message)}`,
          );
        }

        return {
          id: data.id,
          model: params.model,
          choices: data.choices.map((c: any, i: number) => ({
            index: i,
            message: {
              role: c.message.role,
              content: c.message.content,
              ...(c.message.tool_calls && { tool_calls: c.message.tool_calls }),
            },
            finish_reason: c.finish_reason,
          })),
          usage: {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
          },
        };
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status;
        const isTimeout =
          err.code === "ECONNABORTED" || err.message?.includes("timeout");

        if (isTimeout || (status && [500, 502, 503, 429].includes(status))) {
          const delay =
            status === 429
              ? Math.min(5000 * 2 ** attempt, 60000)
              : Math.min(2000 * 2 ** attempt, 15000);
          this.logger.warn(
            `[OpenRouter chat] Attempt ${attempt + 1}/${maxRetries} failed (${isTimeout ? "timeout" : status}). Retrying in ${delay}ms...`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  async *chatStream(
    params: ChatRequest,
  ): AsyncGenerator<string, void, unknown> {
    const body: Record<string, unknown> = {
      model: params.providerId,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 4096,
      stream: true,
    };

    if (this.supportsReasoning(params.providerId) && params.reasoning_effort) {
      body.reasoning_effort = params.reasoning_effort;
    }

    if (params.response_format) {
      body.response_format = params.response_format;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = params.tool_choice ?? "auto";
    }

    this.logger.log(
      `[OpenRouter chatStream] model=${params.providerId} tool_choice=${JSON.stringify(body.tool_choice)} tools=${(params.tools || []).length}`,
    );

    let response;
    try {
      response = await axios.post(`${this.baseUrl}/chat/completions`, body, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": this.appUrl,
          "X-Title": this.appTitle,
        },
        timeout: 120000,
        responseType: "stream",
      });
    } catch (err: any) {
      const errBody = err.response?.data
        ? await this.drainStream(err.response.data)
        : err.message;
      this.logger.error(
        `OpenRouter stream error (${err.response?.status}): ${errBody}`,
      );
      throw err;
    }

    const stream = response.data as NodeJS.ReadableStream;
    let buffer = "";
    let chunkCount = 0;
    let completed = false;

    this.logger.log(
      `[OpenRouter chatStream] Stream connected, waiting for data...`,
    );

    stream.on("error", (err: any) => {
      if (completed) return;
      this.logger.warn(
        `[OpenRouter chatStream] Stream error event: ${err.message}`,
      );
    });

    try {
      for await (const chunk of stream) {
        chunkCount++;
        if (chunkCount === 1) {
          this.logger.log(
            `[OpenRouter chatStream] First chunk received (${chunk.toString().length} bytes)`,
          );
        }
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            this.logger.log(
              `[OpenRouter chatStream] Stream complete (${chunkCount} chunks)`,
            );
            completed = true;
            return;
          }
          yield payload;
        }
      }
    } catch (err: any) {
      if (err.message === "aborted" || err.code === "ECONNRESET") {
        completed = true;
        this.logger.warn(
          `[OpenRouter chatStream] Stream aborted after ${chunkCount} chunks (client likely disconnected)`,
        );
        return;
      }
      throw err;
    }

    this.logger.log(
      `[OpenRouter chatStream] Stream ended without [DONE] (${chunkCount} chunks)`,
    );
  }

  private async drainStream(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
  }
}
