import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { McpUserService } from "./mcp-user.service";
import { maskKey } from "../utils/mask-key";
import { getSupportedProviders } from "../utils/get-supported-providers";
import { getDefaultPolicy } from "../utils/get-default-policy";
import { buildProviderRoute } from "../utils/build-provider-route";
import { isProvider } from "../utils/is-provider";
import { clampNumber } from "../utils/clamp-number";
import { cleanUrl } from "../utils/clean-url";
import { truncate } from "../utils/truncate";
import { formatForTool } from "../utils/format-for-tool";
import { extractTitleFromTopic } from "../utils/extract-title-from-topic";

export type WebSearchProvider = "brave-search" | "duckduckgo";

export type WebSearchPolicy = {
  allowedProviders: WebSearchProvider[];
  preferredProvider: WebSearchProvider;
  maxResults: number;
  dailyLimitPerUser: number;
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  provider: WebSearchProvider;
};

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private readonly cache = new Map<
    string,
    { expiresAt: number; results: SearchResult[] }
  >();

  private static readonly POLICY_KEY_PREFIX = "web_search_policy:";
  private static readonly USAGE_KEY_PREFIX = "web_search_usage:";
  private static readonly BRAVE_CREDENTIAL_PROVIDER = "web-search-brave";

  constructor(
    private readonly prisma: PrismaService,
    private readonly mcpUserService: McpUserService,
  ) {}

  async getPolicy(workspaceId: string): Promise<WebSearchPolicy> {
    const defaults = getDefaultPolicy();
    const row = await this.prisma.appConfig.findUnique({
      where: { key: `${WebSearchService.POLICY_KEY_PREFIX}${workspaceId}` },
    });

    if (!row) return defaults;

    try {
      const parsed = JSON.parse(row.value) as Partial<WebSearchPolicy>;
      const allowedProviders = (parsed.allowedProviders || []).filter((p) =>
        isProvider(p),
      ) as WebSearchProvider[];
      const preferredProvider = isProvider(parsed.preferredProvider)
        ? parsed.preferredProvider
        : defaults.preferredProvider;
      const maxResults = clampNumber(parsed.maxResults, 1, 10, 5);
      const dailyLimitPerUser = clampNumber(
        parsed.dailyLimitPerUser,
        1,
        1000,
        100,
      );

      const normalizedAllowed =
        allowedProviders.length > 0 ? allowedProviders : defaults.allowedProviders;

      return {
        allowedProviders: normalizedAllowed,
        preferredProvider: normalizedAllowed.includes(preferredProvider)
          ? preferredProvider
          : normalizedAllowed[0],
        maxResults,
        dailyLimitPerUser,
      };
    } catch {
      return defaults;
    }
  }

  async updatePolicy(
    workspaceId: string,
    patch: Partial<WebSearchPolicy>,
  ): Promise<WebSearchPolicy> {
    const current = await this.getPolicy(workspaceId);

    const allowedProviders = (patch.allowedProviders || current.allowedProviders).filter(
      (p) => isProvider(p),
    ) as WebSearchProvider[];

    if (allowedProviders.length === 0) {
      throw new BadRequestException(
        "At least one allowed provider is required",
      );
    }

    const preferredCandidate = patch.preferredProvider || current.preferredProvider;
    const preferredProvider = allowedProviders.includes(preferredCandidate)
      ? preferredCandidate
      : allowedProviders[0];

    const merged: WebSearchPolicy = {
      allowedProviders,
      preferredProvider,
      maxResults: clampNumber(
        patch.maxResults,
        1,
        10,
        current.maxResults,
      ),
      dailyLimitPerUser: clampNumber(
        patch.dailyLimitPerUser,
        1,
        1000,
        current.dailyLimitPerUser,
      ),
    };

    await this.prisma.appConfig.upsert({
      where: { key: `${WebSearchService.POLICY_KEY_PREFIX}${workspaceId}` },
      create: {
        key: `${WebSearchService.POLICY_KEY_PREFIX}${workspaceId}`,
        value: JSON.stringify(merged),
      },
      update: {
        value: JSON.stringify(merged),
      },
    });

    return merged;
  }

  async upsertBraveApiKey(
    userId: string,
    workspaceId: string,
    apiKey: string,
  ): Promise<{ connected: boolean; provider: string; maskedKey: string }> {
    const trimmed = (apiKey || "").trim();
    if (!trimmed || trimmed.length < 20) {
      throw new BadRequestException("Invalid Brave API key format");
    }

    await this.validateBraveKey(trimmed);

    await this.mcpUserService.connectWithToken(
      userId,
      workspaceId,
      WebSearchService.BRAVE_CREDENTIAL_PROVIDER,
      {
        BRAVE_API_KEY: trimmed,
      },
    );

    return {
      connected: true,
      provider: "brave-search",
      maskedKey: maskKey(trimmed),
    };
  }

  async revokeBraveApiKey(userId: string, workspaceId: string) {
    try {
      return await this.mcpUserService.revokeCredential(
        userId,
        workspaceId,
        WebSearchService.BRAVE_CREDENTIAL_PROVIDER,
      );
    } catch (err) {
      if (err instanceof NotFoundException) {
        return { disconnected: true, provider: "brave-search" };
      }
      throw err;
    }
  }

  async getUserWebSearchStatus(userId: string, workspaceId: string) {
    const policy = await this.getPolicy(workspaceId);
    const creds = await this.mcpUserService.resolveCredentials(
      userId,
      workspaceId,
      WebSearchService.BRAVE_CREDENTIAL_PROVIDER,
    );

    return {
      connected: !!creds?.BRAVE_API_KEY,
      provider: "brave-search",
      maskedKey: creds?.BRAVE_API_KEY
        ? maskKey(creds.BRAVE_API_KEY)
        : null,
      policy,
      supportedProviders: getSupportedProviders(),
    };
  }

  async search(
    userId: string,
    workspaceId: string,
    query: string,
    requestedMaxResults?: number,
  ): Promise<string> {
    const normalizedQuery = (query || "").trim();
    if (!normalizedQuery) {
      throw new BadRequestException("web_search query is required");
    }

    const policy = await this.getPolicy(workspaceId);
    const effectiveMaxResults = clampNumber(
      requestedMaxResults,
      1,
      10,
      policy.maxResults,
    );

    await this.enforceDailyQuota(userId, workspaceId, policy.dailyLimitPerUser);

    const route = buildProviderRoute(policy);
    const errors: string[] = [];

    for (const provider of route) {
      try {
        const results = await this.searchWithProvider(
          provider,
          userId,
          workspaceId,
          normalizedQuery,
          effectiveMaxResults,
        );

        if (results.length > 0) {
          await this.incrementUsage(userId, workspaceId);
          return formatForTool(normalizedQuery, provider, results);
        }
      } catch (err: any) {
        const message = err?.message || `Provider ${provider} failed`;
        errors.push(`${provider}: ${message}`);
      }
    }

    const hasBraveAllowed = policy.allowedProviders.includes("brave-search");
    const braveCreds = hasBraveAllowed
      ? await this.mcpUserService.resolveCredentials(
          userId,
          workspaceId,
          WebSearchService.BRAVE_CREDENTIAL_PROVIDER,
        )
      : null;

    if (hasBraveAllowed && !braveCreds?.BRAVE_API_KEY) {
      return `Web search is not configured for this user. Please connect your Brave API key in Integrations settings. Query: "${normalizedQuery}"`;
    }

    if (errors.length > 0) {
      return `Web search could not retrieve results for "${normalizedQuery}". Provider attempts: ${errors.join(" | ")}`;
    }

    return `No relevant web results found for "${normalizedQuery}".`;
  }

  private async searchWithProvider(
    provider: WebSearchProvider,
    userId: string,
    workspaceId: string,
    query: string,
    maxResults: number,
  ): Promise<SearchResult[]> {
    const cacheKey = `${provider}:${workspaceId}:${query.toLowerCase()}:${maxResults}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.results;
    }

    let results: SearchResult[] = [];
    if (provider === "brave-search") {
      const creds = await this.mcpUserService.resolveCredentials(
        userId,
        workspaceId,
        WebSearchService.BRAVE_CREDENTIAL_PROVIDER,
      );

      if (!creds?.BRAVE_API_KEY) {
        throw new BadRequestException("Brave API key is not connected");
      }

      results = await this.searchBrave(creds.BRAVE_API_KEY, query, maxResults);
    } else {
      results = await this.searchDuckDuckGo(query, maxResults);
    }

    this.cache.set(cacheKey, {
      expiresAt: Date.now() + 5 * 60 * 1000,
      results,
    });

    return results;
  }

  private async validateBraveKey(apiKey: string): Promise<void> {
    const response = await fetch(
      "https://api.search.brave.com/res/v1/web/search?q=validation&count=1",
      {
        method: "GET",
        headers: {
          "X-Subscription-Token": apiKey,
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new BadRequestException(
        "Invalid Brave API key or provider rejected validation",
      );
    }
  }

  private async searchBrave(
    apiKey: string,
    query: string,
    maxResults: number,
  ): Promise<SearchResult[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(`Brave search failed (${response.status}): ${body}`);
      throw new BadRequestException(`Brave search failed (${response.status})`);
    }

    const data = (await response.json()) as any;
    const items = Array.isArray(data?.web?.results)
      ? data.web.results
      : Array.isArray(data?.results)
        ? data.results
        : [];

    return items.slice(0, maxResults).map((item: any) => ({
      title: (item?.title || "Untitled").toString(),
      url: cleanUrl((item?.url || item?.link || "").toString()),
      snippet: truncate(
        (item?.description || item?.snippet || "").toString(),
        240,
      ),
      provider: "brave-search",
    }));
  }

  private async searchDuckDuckGo(
    query: string,
    maxResults: number,
  ): Promise<SearchResult[]> {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("no_redirect", "1");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new BadRequestException(
        `DuckDuckGo search failed (${response.status})`,
      );
    }

    const data = (await response.json()) as any;
    const results: SearchResult[] = [];

    if (data?.AbstractURL || data?.AbstractText) {
      results.push({
        title: data?.Heading || "DuckDuckGo Instant Answer",
        url: cleanUrl((data?.AbstractURL || "").toString()),
        snippet: truncate((data?.AbstractText || "").toString(), 240),
        provider: "duckduckgo",
      });
    }

    const topics = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
    for (const topic of topics) {
      if (results.length >= maxResults) break;

      if (topic?.FirstURL || topic?.Text) {
        results.push({
          title: extractTitleFromTopic((topic?.Text || "").toString()),
          url: cleanUrl((topic?.FirstURL || "").toString()),
          snippet: truncate((topic?.Text || "").toString(), 240),
          provider: "duckduckgo",
        });
        continue;
      }

      if (Array.isArray(topic?.Topics)) {
        for (const nested of topic.Topics) {
          if (results.length >= maxResults) break;
          if (!nested?.FirstURL && !nested?.Text) continue;
          results.push({
            title: extractTitleFromTopic((nested?.Text || "").toString()),
            url: cleanUrl((nested?.FirstURL || "").toString()),
            snippet: truncate((nested?.Text || "").toString(), 240),
            provider: "duckduckgo",
          });
        }
      }
    }

    return results.slice(0, maxResults);
  }

  private usageKey(userId: string, workspaceId: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return `${WebSearchService.USAGE_KEY_PREFIX}${workspaceId}:${userId}:${today}`;
  }

  private async enforceDailyQuota(
    userId: string,
    workspaceId: string,
    dailyLimit: number,
  ): Promise<void> {
    const row = await this.prisma.appConfig.findUnique({
      where: { key: this.usageKey(userId, workspaceId) },
    });

    const used = row ? Number(row.value || "0") : 0;
    if (used >= dailyLimit) {
      throw new BadRequestException(
        `Web search daily limit reached (${dailyLimit}/day).`,
      );
    }
  }

  private async incrementUsage(userId: string, workspaceId: string): Promise<void> {
    const key = this.usageKey(userId, workspaceId);
    const row = await this.prisma.appConfig.findUnique({ where: { key } });
    const next = (row ? Number(row.value || "0") : 0) + 1;

    await this.prisma.appConfig.upsert({
      where: { key },
      create: { key, value: String(next) },
      update: { value: String(next) },
    });
  }
}