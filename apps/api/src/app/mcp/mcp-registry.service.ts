import { Injectable } from "@nestjs/common";

/**
 * Registry of known MCP server packages and their configurations.
 * Maps provider names to their npm packages and required env vars.
 */
export interface McpPackageInfo {
  package: string;
  displayName: string;
  description: string;
  envKeys: string[]; // Required env vars for this server
  authType: "oauth" | "token" | "api_key";
  tools: string[]; // Known tool names exposed by this server
  docsUrl?: string;
}

@Injectable()
export class McpRegistryService {
  private readonly registry: Record<string, McpPackageInfo> = {
    "google-gmail": {
      package: "@gongrzhe/server-gmail-autoauth-mcp",
      displayName: "Gmail",
      description: "Send, search, and read emails via Gmail",
      envKeys: [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REFRESH_TOKEN",
      ],
      authType: "oauth",
      tools: ["gmail_send", "gmail_search", "gmail_read", "gmail_list"],
    },
    "google-calendar": {
      package: "@cocal/google-calendar-mcp",
      displayName: "Google Calendar",
      description: "Manage calendar events and find availability",
      envKeys: [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REFRESH_TOKEN",
      ],
      authType: "oauth",
      tools: [
        "list-calendars",
        "list-events",
        "search-events",
        "create-event",
        "update-event",
        "delete-event",
        "get-freebusy",
      ],
    },
    "google-sheets": {
      package: "google-sheets-mcp",
      displayName: "Google Sheets",
      description: "Read, write, and manage Google Spreadsheets",
      envKeys: [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REFRESH_TOKEN",
      ],
      authType: "oauth",
      tools: [
        "sheets_spreadsheet_get",
        "sheets_spreadsheet_create",
        "sheets_values_get",
        "sheets_values_update",
        "sheets_values_append",
        "sheets_values_clear",
        "sheets_sheets_list",
        "sheets_sheet_add",
        "sheets_sheet_delete",
      ],
    },
    github: {
      package: "@modelcontextprotocol/server-github",
      displayName: "GitHub",
      description: "Manage issues, PRs, repos, and files on GitHub",
      envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
      authType: "token",
      tools: [
        "create_issue",
        "search_repositories",
        "create_pull_request",
        "get_file_contents",
        "list_commits",
        "search_code",
      ],
    },
    slack: {
      package: "@modelcontextprotocol/server-slack",
      displayName: "Slack",
      description: "Send messages and interact with Slack workspaces",
      envKeys: ["SLACK_BOT_TOKEN"],
      authType: "token",
      tools: [
        "send_message",
        "list_channels",
        "search_messages",
        "get_channel_history",
      ],
    },
    notion: {
      package: "@modelcontextprotocol/server-notion",
      displayName: "Notion",
      description: "Create pages, query databases in Notion",
      envKeys: ["NOTION_API_KEY"],
      authType: "token",
      tools: ["create_page", "search", "query_database", "update_page"],
    },
    linear: {
      package: "@modelcontextprotocol/server-linear",
      displayName: "Linear",
      description: "Manage issues and projects in Linear",
      envKeys: ["LINEAR_API_KEY"],
      authType: "api_key",
      tools: ["create_issue", "search_issues", "update_issue", "list_projects"],
    },
    "brave-search": {
      package: "@modelcontextprotocol/server-brave-search",
      displayName: "Brave Search",
      description: "Search the web using Brave Search API",
      envKeys: ["BRAVE_API_KEY"],
      authType: "api_key",
      tools: ["brave_web_search", "brave_local_search"],
      docsUrl: "https://api.search.brave.com/",
    },
  };

  getPackageInfo(name: string): McpPackageInfo | undefined {
    return this.registry[name];
  }

  getAllPackages(): Record<string, McpPackageInfo> {
    return this.registry;
  }

  getCommand(name: string): { command: string; args: string[] } | undefined {
    const info = this.registry[name];
    if (!info) return undefined;
    return {
      command: "npx",
      args: ["-y", info.package],
    };
  }

  /**
   * Check if a provider name uses Google OAuth (shared credentials flow)
   */
  isGoogleProvider(name: string): boolean {
    return name.startsWith("google-");
  }
}
