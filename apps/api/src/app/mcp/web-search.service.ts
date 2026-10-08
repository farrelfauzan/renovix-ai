import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { McpUserService } from "./mcp-user.service";

type WebSearchProvider = "brave-search" | "duckduckgo";

type WebSearchPolicy = {
  allowedProviders: WebSearchProvider[];
  preferredProvider: WebSearchProvider;
  maxResults: number;
  dailyLimitPerUser: number;
};

type SearchResult = {
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

  getSupportedProviders() {
    return ["brave-search", "duckduckgo"] as const;
  }

  getDefaultPolicy(): WebSearchPolicy {
    return {
      allowedProviders: ["brave-search"],
      preferredProvider: "brave-search",
      maxResults: 5,
      dailyLimitPerUser: 100,
    };
  }

  async getPolicy(workspaceId: string): Promise<WebSearchPolicy> {
    const defaults = this.getDefaultPolicy();
    const row = await this.prisma.appConfig.findUnique({
      where: { key: `${WebSearchService.POLICY_KEY_PREFIX}${workspaceId}` },
    });

    if (!row) return defaults;

    try {
      const parsed = JSON.parse(row.value) as Partial<WebSearchPolicy>;
      const allowedProviders = (parsed.allowedProviders || []).filter((p) =>
        this.isProvider(p),
      ) as WebSearchProvider[];
      const preferredProvider = this.isProvider(parsed.preferredProvider)
        ? parsed.preferredProvider
        : defaults.preferredProvider;
      const maxResults = this.clampNumber(parsed.maxResults, 1, 10, 5);
      const dailyLimitPerUser = this.clampNumber(
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
      (p) => this.isProvider(p),
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
      maxResults: this.clampNumber(
        patch.maxResults,
        1,
        10,
        current.maxResults,
      ),
      dailyLimitPerUser: this.clampNumber(
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
      maskedKey: this.maskKey(trimmed),
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
        ? this.maskKey(creds.BRAVE_API_KEY)
        : null,
      policy,
      supportedProviders: this.getSupportedProviders(),
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
    const effectiveMaxResults = this.clampNumber(
      requestedMaxResults,
      1,
      10,
      policy.maxResults,
    );

    await this.enforceDailyQuota(userId, workspaceId, policy.dailyLimitPerUser);

    const route = this.buildProviderRoute(policy);
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
          return this.formatForTool(normalizedQuery, provider, results);
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
      url: this.cleanUrl((item?.url || item?.link || "").toString()),
      snippet: this.truncate(
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
        url: this.cleanUrl((data?.AbstractURL || "").toString()),
        snippet: this.truncate((data?.AbstractText || "").toString(), 240),
        provider: "duckduckgo",
      });
    }

    const topics = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
    for (const topic of topics) {
      if (results.length >= maxResults) break;

      if (topic?.FirstURL || topic?.Text) {
        results.push({
          title: this.extractTitleFromTopic((topic?.Text || "").toString()),
          url: this.cleanUrl((topic?.FirstURL || "").toString()),
          snippet: this.truncate((topic?.Text || "").toString(), 240),
          provider: "duckduckgo",
        });
        continue;
      }

      if (Array.isArray(topic?.Topics)) {
        for (const nested of topic.Topics) {
          if (results.length >= maxResults) break;
          if (!nested?.FirstURL && !nested?.Text) continue;
          results.push({
            title: this.extractTitleFromTopic((nested?.Text || "").toString()),
            url: this.cleanUrl((nested?.FirstURL || "").toString()),
            snippet: this.truncate((nested?.Text || "").toString(), 240),
            provider: "duckduckgo",
          });
        }
      }
    }

    return results.slice(0, maxResults);
  }

  private formatForTool(
    query: string,
    provider: WebSearchProvider,
    results: SearchResult[],
  ): string {
    if (results.length === 0) {
      return `No relevant web results found for "${query}".`;
    }

    const lines: string[] = [];
    lines.push(`Top web results for "${query}" via ${provider}:`);
    results.forEach((result, idx) => {
      const hostname = this.extractHostname(result.url);
      lines.push(`${idx + 1}. ${result.title}`);
      lines.push(`   URL: ${result.url}`);
      if (hostname) lines.push(`   Source: ${hostname}`);
      lines.push(`   Snippet: ${result.snippet || "No snippet available."}`);
    });
    return lines.join("\n");
  }

  private buildProviderRoute(policy: WebSearchPolicy): WebSearchProvider[] {
    const unique = Array.from(new Set(policy.allowedProviders));
    const preferred = policy.preferredProvider;
    return [preferred, ...unique.filter((p) => p !== preferred)];
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

  private isProvider(value: unknown): value is WebSearchProvider {
    return value === "brave-search" || value === "duckduckgo";
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(num)));
  }

  private maskKey(value: string): string {
    if (!value) return "";
    if (value.length <= 8) return "****";
    return `${value.slice(0, 4)}****${value.slice(-3)}`;
  }

  private cleanUrl(url: string): string {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "gclid",
        "fbclid",
      ].forEach((param) => parsed.searchParams.delete(param));
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private extractHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  private truncate(value: string, max: number): string {
    if (!value) return "";
    return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
  }

  private extractTitleFromTopic(text: string): string {
    if (!text) return "Untitled";
    const idx = text.indexOf(" - ");
    if (idx > 0) {
      return text.slice(0, idx).trim();
    }
    return this.truncate(text, 80);
  }
}