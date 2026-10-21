import { Injectable, Logger } from "@nestjs/common";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { AgentMemoryService } from "./agent-memory.service";
import { DocumentService } from "../../document/service/document.service";
import { ChannelChatRoomRepository } from "../../channel/repository/channel-chat-room.repository";
import { ReminderRepository } from "../../reminder/repository/reminder.repository";
import { WorkspaceRepository } from "../../workspace/repository/workspace.repository";
import { CronExpressionParser } from "cron-parser";
import { executeCalculator } from "../utils/execute-calculator";
import { executeKnowledgeRetrieval } from "../utils/execute-knowledge-retrieval";
import { mcpToolToOpenAI } from "../../mcp/utils/mcp-tool-to-openai";
import type { McpToolSchema } from "../../mcp/service/mcp-client.service";
import type { McpConnection } from "../../mcp/types/mcp-connection";
import type { McpRunSession } from "../types/mcp-run-session";

interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

@Injectable()
export class AgentToolService {
  private readonly logger = new Logger(AgentToolService.name);

  private stripSchemaDescriptions(schema: unknown): void {
    if (!schema || typeof schema !== "object") return;

    const obj = schema as Record<string, unknown>;
    delete obj.description;

    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          this.stripSchemaDescriptions(item);
        }
        continue;
      }

      this.stripSchemaDescriptions(value);
    }
  }

  // Store last generated document result for the current run
  private lastDocumentResult: {
    format: string;
    url: string;
    filename: string;
    expiresAt: string;
    key: string;
  } | null = null;

  constructor(
    private readonly mcpClient: McpClientService,
    private readonly mcpService: McpService,
    private readonly mcpUserService: McpUserService,
    private readonly webSearchService: WebSearchService,
    private readonly memoryService: AgentMemoryService,
    private readonly documentService: DocumentService,
    private readonly chatRooms: ChannelChatRoomRepository,
    private readonly reminders: ReminderRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  // ─── Built-in tool definitions (internal tools that need direct DB/process access) ───
  private readonly toolDefinitions: Record<string, ToolSchema> = {
    web_search: {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the internet for current information",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
            maxResults: {
              type: "number",
              description: "Optional maximum number of results to return (1-10)",
            },
          },
          required: ["query"],
        },
      },
    },
    calculator: {
      type: "function",
      function: {
        name: "calculator",
        description: "Evaluate a mathematical expression",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "The mathematical expression to evaluate",
            },
          },
          required: ["expression"],
        },
      },
    },
    knowledge_retrieval: {
      type: "function",
      function: {
        name: "knowledge_retrieval",
        description:
          "Search the agent's attached knowledge bases for relevant information",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query for knowledge retrieval",
            },
          },
          required: ["query"],
        },
      },
    },
    memory_store: {
      type: "function",
      function: {
        name: "memory_store",
        description:
          "Store an important fact about the user for future conversations",
        parameters: {
          type: "object",
          properties: {
            fact: {
              type: "string",
              description: "The fact to remember about the user",
            },
            type: {
              type: "string",
              enum: ["interest", "preference", "context"],
              description: "The type of memory",
            },
          },
          required: ["fact", "type"],
        },
      },
    },
    delegate_to_subagent: {
      type: "function",
      function: {
        name: "delegate_to_subagent",
        description: "Delegate a specific task to a sub-agent",
        parameters: {
          type: "object",
          properties: {
            subAgentId: {
              type: "string",
              description: "The ID of the sub-agent to delegate to",
            },
            task: {
              type: "string",
              description: "Description of the task to delegate",
            },
          },
          required: ["subAgentId", "task"],
        },
      },
    },
    create_reminder: {
      type: "function",
      function: {
        name: "create_reminder",
        description:
          "Create a scheduled reminder that will automatically execute a prompt and send the response to the user at the specified time. Use this when the user asks to be reminded about something on a schedule.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "The instruction/question to execute on schedule (e.g., 'Give me a summary of my expenses')",
            },
            cronExpression: {
              type: "string",
              description:
                "Cron expression for the schedule (e.g., '0 8 * * *' for every day at 8 AM, '0 9 * * 1' for every Monday at 9 AM)",
            },
            description: {
              type: "string",
              description:
                "Short human-readable label for the reminder (e.g., 'Daily expense summary')",
            },
            timezone: {
              type: "string",
              description:
                "IANA timezone (e.g., 'Asia/Jakarta', 'America/New_York'). Defaults to UTC if not specified.",
            },
          },
          required: ["prompt", "cronExpression"],
        },
      },
    },
    create_document: {
      type: "function",
      function: {
        name: "create_document",
        description:
          "Generate and export a document file (PDF, Word, or Excel) from markdown content. Use this ONLY when the user explicitly asks for a PDF, DOCX, or XLSX file. DO NOT use this tool if the user asks for Google Sheets, Google Docs, or other cloud services. If they ask for Google Sheets, reply in plain text that you can only generate XLSX files, which can be directly uploaded to Google Sheets with 100% fidelity.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description:
                "The full document content in Markdown format. Use proper headings (#, ##, ###), lists, tables, and formatting. Write complete, professional-quality content.",
            },
            format: {
              type: "string",
              enum: ["pdf", "docx", "xlsx"],
              description:
                "The output file format. Must be pdf, docx, or xlsx.",
            },
            filename: {
              type: "string",
              description:
                "Optional filename for the document (without extension)",
            },
          },
          required: ["content", "format"],
        },
      },
    },
  };

  buildToolSchemas(
    agentTools: any[],
    options?: { injectDelegation?: boolean },
  ): ToolSchema[] {
    const schemas: ToolSchema[] = [];

    for (const tool of agentTools) {
      const schema = this.toolDefinitions[tool.toolType];
      if (schema) {
        schemas.push(schema);
      }
    }

    // Auto-inject delegate_to_subagent for parent agents with sub-agents
    if (
      options?.injectDelegation &&
      !schemas.some((s) => s.function.name === "delegate_to_subagent")
    ) {
      schemas.push(this.toolDefinitions["delegate_to_subagent"]);
    }

    // Auto-inject create_document for all agents (core platform feature)
    if (!schemas.some((s) => s.function.name === "create_document")) {
      schemas.push(this.toolDefinitions["create_document"]);
    }

    return schemas;
  }

  /**
   * Build tool schemas including MCP tools from user's connected providers.
   * Connects to each provider using the executing user's credentials,
   * discovers tools, and merges them with built-in tools.
   * RNX-217: every connection opened goes into the run's own `options.mcpSession` (with the tool names it serves),
   * which the caller created before this call and closes with cleanupMcpConnections in a `finally`.
   */
  async buildToolSchemasWithMcp(
    agentTools: any[],
    agentId: string,
    executingUserId: string | undefined,
    workspaceId: string | undefined,
    options: { injectDelegation?: boolean; mcpSession: McpRunSession },
  ): Promise<ToolSchema[]> {
    // 1. Built-in tools
    const schemas = this.buildToolSchemas(agentTools, options);

    // 2. Discover MCP tools from user's connected providers
    if (!executingUserId || !workspaceId || !(await this.isSharedWorkspace(workspaceId))) {
      this.logger.warn(
        `[buildToolSchemasWithMcp] Skipping MCP discovery: userId=${executingUserId ? "SET" : "MISSING"} workspaceId=${workspaceId ? "SET" : "MISSING"}`,
      );
      return schemas;
    }

    try {
      this.logger.debug(
        `[buildToolSchemasWithMcp] Discovering MCP tools for userId=${executingUserId} workspace=${workspaceId}`,
      );

      const userCredMap = await this.mcpUserService.getUserConnectedProviders(
        executingUserId,
        workspaceId,
      );

      this.logger.log(
        `[buildToolSchemasWithMcp] userId=${executingUserId} workspace=${workspaceId} foundProviders=${userCredMap.size}`,
      );

      if (userCredMap.size === 0) {
        this.logger.debug(
          `[buildToolSchemasWithMcp] No MCP providers connected for this user/workspace. Using only built-in tools (${schemas.length}).`,
        );
        return schemas;
      }

      for (const [provider, env] of userCredMap) {
        try {
          const config = this.mcpService.buildConfigFromProvider(
            provider,
            env,
            executingUserId,
          );
          if (!config) {
            this.logger.debug(
              `No registry entry for provider ${provider}, skipping`,
            );
            continue;
          }

          const connection = await this.mcpClient.connect(config);
          options.mcpSession.connections.push(connection);
          const { tools } = await connection.client.listTools();
          const mcpTools = tools as McpToolSchema[];

          this.logger.log(
            `[buildToolSchemasWithMcp] Connected to ${provider} (${config.id}), found ${mcpTools.length} tools`,
          );

          for (const tool of mcpTools) {
            const schema = mcpToolToOpenAI(tool);
            if (
              schema.function.description &&
              schema.function.description.length > 120
            ) {
              schema.function.description = schema.function.description.slice(
                0,
                120,
              );
            }
            this.stripSchemaDescriptions(schema.function.parameters);
            schemas.push(schema);
            options.mcpSession.toolConnections.set(tool.name, connection);
          }
        } catch (err: any) {
          this.logger.warn(
            `Failed to connect MCP provider ${provider}: ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to load MCP credentials for user ${executingUserId}: ${err.message}`,
      );
    }

    return schemas;
  }

  /** RNX-217: an MCP tool runs only on a connection of the calling run's own `mcpSession`. */
  async executeTool(
    toolName: string,
    args: any,
    agent: any,
    mcpSession: McpRunSession,
    userId?: string,
    channelId?: string,
  ): Promise<string> {
    const timeout = 30000; // 30s timeout per tool

    const executeWithTimeout = async (): Promise<string> => {
      // Check if it's an MCP tool
      const mcpConnection = mcpSession.toolConnections.get(toolName);
      if (mcpConnection) {
        return this.executeMcpTool(mcpConnection, toolName, args);
      }

      // Built-in tools
      switch (toolName) {
        case "calculator":
          return executeCalculator(args);
        case "web_search":
          return this.executeWebSearch(args, userId, agent?.workspaceId);
        case "knowledge_retrieval":
          return executeKnowledgeRetrieval(args, agent);
        case "memory_store":
          return this.executeMemoryStore(args, agent, userId, channelId);
        case "create_reminder":
          return this.executeCreateReminder(args, agent, userId, channelId);
        case "create_document":
          return this.executeCreateDocument(args);
        default:
          return `Tool "${toolName}" is not available. It may require an MCP integration to be connected.`;
      }
    };

    return Promise.race([
      executeWithTimeout(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Tool execution timeout")), timeout),
      ),
    ]);
  }

  /**
   * Execute a tool via MCP server
   */
  private async executeMcpTool(
    connection: McpConnection,
    toolName: string,
    args: any,
  ): Promise<string> {
    try {
      const result = await connection.client.callTool({ name: toolName, arguments: args });

      // MCP returns content as an array of content blocks
      if (result.content && Array.isArray(result.content)) {
        return result.content
          .map((block: any) => {
            if (block.type === "text") return block.text;
            if (block.type === "image") return `[Image: ${block.mimeType}]`;
            return JSON.stringify(block);
          })
          .join("\n");
      }

      return JSON.stringify(result);
    } catch (err: any) {
      this.logger.error(`MCP tool ${toolName} error: ${err.message}`);
      return `Error executing ${toolName}: ${err.message}`;
    }
  }

  /**
   * RNX-217: closes the connections of one run's session, and no other run's, concurrently; waits for all of them.
   * A connection that fails to close is logged by its server id only, and the others are still closed. The session
   * is emptied first, so a second call closes nothing.
   */
  async cleanupMcpConnections(mcpSession: McpRunSession): Promise<void> {
    const connections = mcpSession.connections.splice(0);
    mcpSession.toolConnections.clear();
    const results = await Promise.allSettled(connections.map((connection) => this.mcpClient.close(connection)));
    results.forEach((result, i) => {
      if (result.status === "rejected") this.logger.warn(`Failed to close MCP server ${connections[i].serverId}`);
    });
  }

  // ─── Tool Implementations ───

  private async executeWebSearch(
    args: { query: string; maxResults?: number },
    userId?: string,
    workspaceId?: string,
  ): Promise<string> {
    if (!userId || !workspaceId || !(await this.isSharedWorkspace(workspaceId))) {
      return "Web search is unavailable because user or workspace context is missing.";
    }

    try {
      return await this.webSearchService.search(
        userId,
        workspaceId,
        args.query,
        args.maxResults,
      );
    } catch (err: any) {
      return `Web search failed: ${err.message}`;
    }
  }

  private async executeMemoryStore(
    args: { fact: string; type: string },
    agent: any,
    userId?: string,
    channelId?: string,
  ): Promise<string> {
    if (!userId) {
      this.logger.warn(
        `[memory_store] No userId provided for agent ${agent.id}`,
      );
      return `Memory store failed: user context unavailable.`;
    }
    try {
      this.logger.log(
        `[memory_store] Storing for agent=${agent.id} userId=${userId} channelId=${channelId ?? "null"} type=${args.type} fact="${(args.fact || "").slice(0, 80)}"`,
      );
      await this.memoryService.storeExplicit(
        agent.id,
        userId,
        args.fact,
        args.type || "context",
        channelId,
      );
      return `Successfully stored memory: "${args.fact}" (type: ${args.type})`;
    } catch (err: any) {
      this.logger.error(`Memory store failed: ${err.message}`, err.stack);
      return `Failed to store memory: ${err.message}`;
    }
  }

  private async executeCreateDocument(args: {
    content: string;
    format: string;
    filename?: string;
  }): Promise<string> {
    if (!args.content || !args.format) {
      return "Error: Both 'content' (markdown) and 'format' (pdf/docx/xlsx) are required.";
    }
    const validFormats = ["pdf", "docx", "xlsx"];
    if (!validFormats.includes(args.format)) {
      return `Error: Invalid format "${args.format}". Must be one of: pdf, docx, xlsx.`;
    }
    try {
      const result = await this.documentService.generateWithStorage(
        args.content,
        args.format,
        args.filename,
      );
      this.lastDocumentResult = result;
      const formatLabels: Record<string, string> = {
        pdf: "PDF",
        docx: "Word document",
        xlsx: "Excel spreadsheet",
      };
      return `Successfully generated ${formatLabels[args.format] || args.format} document: "${result.filename}". The file is ready for download.`;
    } catch (err: any) {
      this.logger.error(`[create_document] Failed: ${err.message}`, err.stack);
      return `Failed to generate document: ${err.message}`;
    }
  }

  getLastDocumentResult() {
    return this.lastDocumentResult;
  }

  clearLastDocumentResult() {
    this.lastDocumentResult = null;
  }

  private async executeCreateReminder(
    args: {
      prompt: string;
      cronExpression: string;
      description?: string;
      timezone?: string;
    },
    agent: any,
    userId?: string,
    channelId?: string,
  ): Promise<string> {
    if (!userId) {
      return "Error: Unable to create reminder — user context unavailable.";
    }
    if (!channelId) {
      return "Error: Unable to create reminder — channel context unavailable.";
    }
    if (!args.prompt || !args.cronExpression) {
      return "Error: Both 'prompt' and 'cronExpression' are required to create a reminder.";
    }

    // Validate cron expression
    const timezone = args.timezone || "UTC";
    let nextRunAt: Date;
    try {
      const interval = CronExpressionParser.parse(args.cronExpression, {
        tz: timezone,
      });
      nextRunAt = interval.next().toDate();
    } catch (err: any) {
      return `Error: Invalid cron expression "${args.cronExpression}". ${err.message}`;
    }

    try {
      // Find or create chat room for this channel
      let chatRoom = await this.chatRooms.findChatRoomByName(
        channelId,
        "general",
      );
      if (!chatRoom) {
        chatRoom = await this.chatRooms.createChatRoom(channelId, "general");
      }

      const reminder = await this.reminders.createReminder(userId, {
        agentId: agent.id,
        channelId,
        chatRoomId: chatRoom.id,
        prompt: args.prompt,
        description: args.description || null,
        cronExpression: args.cronExpression,
        timezone,
        nextRunAt,
      });

      this.logger.log(
        `[create_reminder] Created reminder ${reminder.id} for user=${userId} agent=${agent.id} cron="${args.cronExpression}" tz=${timezone}`,
      );

      const nextRunFormatted = nextRunAt.toLocaleString("en-US", {
        timeZone: timezone,
      });

      return `Successfully created reminder "${args.description || args.prompt.slice(0, 50)}". Next execution: ${nextRunFormatted} (${timezone}). Reminder ID: ${reminder.id}`;
    } catch (err: any) {
      this.logger.error(`[create_reminder] Failed: ${err.message}`, err.stack);
      return `Failed to create reminder: ${err.message}`;
    }
  }

  /**
   * False for the owner's default workspace (RNX-117, answer 1): an agent there gets no MCP discovery and no
   * web search, like an agent with no workspace before every agent had one.
   */
  private async isSharedWorkspace(workspaceId: string): Promise<boolean> {
    const workspace = await this.workspaces.findDefaultFlag(workspaceId);
    return !!workspace && !workspace.isDefault;
  }
}
