# MCP Tools Integration Strategy

## Overview

Integrate [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) into Renovix AI's agent system to give agents access to external tools via standardized MCP servers. This enables agents to interact with Google Workspace, GitHub, Slack, and other services through a unified protocol instead of bespoke integrations.

---

## Why MCP?

Currently, each integration (Jira, Slack, Notion, GitHub, Calendar) is hand-coded in `AgentToolService` with custom tool definitions and execution logic. MCP provides:

- **Standardized protocol** — tools are discovered dynamically from MCP servers
- **Community servers** — 100+ open-source MCP servers available (Google Workspace, GitHub, Slack, etc.)
- **Hot-pluggable** — add new tools without code changes
- **Sandboxed** — each MCP server runs as a separate process with its own auth

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Agent Run Service                      │
│                                                            │
│   LLM ←→ Tool Loop ←→ AgentToolService                   │
│                              │                             │
│              ┌───────────────┼───────────────┐             │
│              ▼               ▼               ▼             │
│        Built-in Tools   MCP Client      Integration Tools  │
│        (calculator,     (dynamic)       (legacy jira,      │
│         web_search)         │            slack, etc.)       │
│                             │                              │
└─────────────────────────────┼──────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     Google Workspace    GitHub MCP      Slack MCP
       MCP Server          Server          Server
```

---

## MCP Servers to Integrate

### 1. Google Workspace MCP Server

**Package**: `@gongrzhe/server-gmail-autoauth-mcp`, `@adenot/google-calendar-mcp`, `@anthropic/mcp-google-drive`

| Tool | Description |
|------|-------------|
| `gmail_send` | Send emails via Gmail |
| `gmail_search` | Search emails |
| `gmail_read` | Read email content |
| `gdrive_list` | List files in Google Drive |
| `gdrive_read` | Read document content |
| `gdrive_create` | Create a new document/sheet |
| `gcalendar_list_events` | List calendar events |
| `gcalendar_create_event` | Create calendar events |
| `gcalendar_find_free_time` | Find availability |
| `gsheets_read` | Read spreadsheet data |
| `gsheets_write` | Write to spreadsheets |
| `gdocs_read` | Read Google Doc content |
| `gdocs_create` | Create Google Doc |

**Auth**: OAuth2 with Google (service account or user consent flow)

### 2. GitHub MCP Server

**Package**: `@modelcontextprotocol/server-github`

| Tool | Description |
|------|-------------|
| `create_issue` | Create GitHub issues |
| `search_repositories` | Search repos |
| `create_pull_request` | Create PRs |
| `get_file_contents` | Read repo files |
| `list_commits` | List commits |

**Auth**: GitHub Personal Access Token

### 3. Slack MCP Server

**Package**: `@modelcontextprotocol/server-slack`

| Tool | Description |
|------|-------------|
| `send_message` | Send messages |
| `list_channels` | List channels |
| `search_messages` | Search workspace messages |
| `get_channel_history` | Read channel history |

**Auth**: Slack Bot Token (xoxb-)

### 4. Notion MCP Server

**Package**: `@modelcontextprotocol/server-notion`

| Tool | Description |
|------|-------------|
| `create_page` | Create pages |
| `search` | Search workspace |
| `query_database` | Query Notion DBs |
| `update_page` | Update pages |

**Auth**: Notion Integration Token

### 5. Linear / Jira MCP Server

**Package**: `@modelcontextprotocol/server-linear` or community Jira server

---

## Implementation Plan

### Phase 1: MCP Client Library

Create an MCP client service that can connect to MCP servers and discover/execute tools.

```typescript
// apps/api/src/app/mcp/mcp-client.service.ts

import { Injectable } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;        // for stdio
  args?: string[];         // for stdio
  url?: string;            // for sse
  env?: Record<string, string>; // environment variables (tokens, etc.)
}

@Injectable()
export class McpClientService {
  private clients = new Map<string, Client>();

  async connectServer(config: McpServerConfig): Promise<void> {
    const client = new Client({ name: 'renovix-agent', version: '1.0.0' });

    if (config.transport === 'stdio') {
      const transport = new StdioClientTransport({
        command: config.command!,
        args: config.args,
        env: { ...process.env, ...config.env },
      });
      await client.connect(transport);
    } else {
      const transport = new SSEClientTransport(new URL(config.url!));
      await client.connect(transport);
    }

    this.clients.set(config.id, client);
  }

  async listTools(serverId: string) {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP server ${serverId} not connected`);
    const { tools } = await client.listTools();
    return tools;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, any>) {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP server ${serverId} not connected`);
    const result = await client.callTool({ name: toolName, arguments: args });
    return result;
  }

  async disconnectServer(serverId: string) {
    const client = this.clients.get(serverId);
    if (client) {
      await client.close();
      this.clients.delete(serverId);
    }
  }

  // Convert MCP tool schemas to OpenAI function-calling format
  mcpToolToOpenAI(mcpTool: any): any {
    return {
      type: 'function',
      function: {
        name: mcpTool.name,
        description: mcpTool.description,
        parameters: mcpTool.inputSchema,
      },
    };
  }
}
```

### Phase 2: Database Schema

Add MCP server configuration to the database:

```prisma
model McpServer {
  id           String   @id @default(uuid())
  name         String
  transport    String   // 'stdio' | 'sse'
  command      String?  // e.g. "npx" for stdio
  args         Json?    // e.g. ["-y", "@anthropic/mcp-server-google"]
  url          String?  // for SSE transport
  envEncrypted Json?    // encrypted env vars (tokens, keys)
  isGlobal     Boolean  @default(false)
  userId       String?
  createdAt    DateTime @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @db.Timestamptz(3)

  user         User?    @relation(fields: [userId], references: [id])
  agents       AgentMcpServer[]

  @@map("mcp_servers")
}

model AgentMcpServer {
  id          String @id @default(uuid())
  agentId     String
  mcpServerId String
  // Optional: restrict which tools from this server the agent can use
  allowedTools Json?  // string[] of tool names, null = all

  agent     Agent     @relation(fields: [agentId], references: [id])
  mcpServer McpServer @relation(fields: [mcpServerId], references: [id])

  @@unique([agentId, mcpServerId])
  @@map("agent_mcp_servers")
}
```

### Phase 3: Integrate with Agent Tool Loop

Modify `AgentToolService` to include MCP tools in the tool schemas sent to the LLM and route execution to the MCP client:

```typescript
// In agent-tool.service.ts

async buildToolSchemasWithMcp(
  agentTools: any[],
  mcpServers: McpServerConfig[],
  options?: { injectDelegation?: boolean }
): Promise<ToolSchema[]> {
  // 1. Built-in tools
  const schemas = this.buildToolSchemas(agentTools, options);

  // 2. Discover MCP tools from connected servers
  for (const server of mcpServers) {
    await this.mcpClient.connectServer(server);
    const mcpTools = await this.mcpClient.listTools(server.id);

    for (const tool of mcpTools) {
      schemas.push(this.mcpClient.mcpToolToOpenAI(tool));
    }
  }

  return schemas;
}

async executeTool(toolName: string, args: any, agent: any): Promise<string> {
  // Check if it's an MCP tool
  const mcpServer = await this.findMcpServerForTool(toolName, agent.id);
  if (mcpServer) {
    const result = await this.mcpClient.callTool(mcpServer.id, toolName, args);
    return JSON.stringify(result.content);
  }

  // Fallback to built-in execution
  return this.executeBuiltinTool(toolName, args, agent);
}
```

### Phase 4: Google Workspace Setup

Use community MCP servers via stdio transport. Each Google service has a dedicated MCP server package:

#### Gmail

```json
{
  "id": "google-gmail",
  "name": "Gmail",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
  "env": {
    "GOOGLE_CLIENT_ID": "{{from_agent_integration}}",
    "GOOGLE_CLIENT_SECRET": "{{from_agent_integration}}",
    "GOOGLE_REFRESH_TOKEN": "{{from_agent_integration}}"
  }
}
```

#### Google Calendar

```json
{
  "id": "google-calendar",
  "name": "Google Calendar",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@adenot/google-calendar-mcp"],
  "env": {
    "GOOGLE_CLIENT_ID": "{{from_agent_integration}}",
    "GOOGLE_CLIENT_SECRET": "{{from_agent_integration}}",
    "GOOGLE_REFRESH_TOKEN": "{{from_agent_integration}}"
  }
}
```

#### Google Drive

```json
{
  "id": "google-drive",
  "name": "Google Drive",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@anthropic/mcp-google-drive"],
  "env": {
    "GOOGLE_CLIENT_ID": "{{from_agent_integration}}",
    "GOOGLE_CLIENT_SECRET": "{{from_agent_integration}}",
    "GOOGLE_REFRESH_TOKEN": "{{from_agent_integration}}"
  }
}
```

#### Google Sheets (via community)

```json
{
  "id": "google-sheets",
  "name": "Google Sheets",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@nicepkg/mcp-server-gsheets"],
  "env": {
    "GOOGLE_CLIENT_ID": "{{from_agent_integration}}",
    "GOOGLE_CLIENT_SECRET": "{{from_agent_integration}}",
    "GOOGLE_REFRESH_TOKEN": "{{from_agent_integration}}"
  }
}
```

#### Multi-tenant Approach

Since each user has their own OAuth refresh token, spawn a **separate stdio process per user session** with that user's credentials injected as env vars. The `McpClientService` manages the lifecycle:

```typescript
async connectGoogleForUser(userId: string, service: string): Promise<void> {
  const integration = await this.prisma.agentIntegration.findFirst({
    where: { userId, type: 'google_workspace' },
  });
  const credentials = this.decrypt(integration.configEncrypted);

  const config: McpServerConfig = {
    id: `google-${service}-${userId}`,
    name: `Google ${service}`,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', this.getPackageForService(service)],
    env: {
      GOOGLE_CLIENT_ID: this.configService.get('MCP_GOOGLE_CLIENT_ID'),
      GOOGLE_CLIENT_SECRET: this.configService.get('MCP_GOOGLE_CLIENT_SECRET'),
      GOOGLE_REFRESH_TOKEN: credentials.refreshToken,
    },
  };

  await this.connectServer(config);
}
```

---

## Google OAuth2 Flow for Users

```
┌─────────┐         ┌──────────┐         ┌─────────────┐
│  User    │────────▶│ Dashboard │────────▶│ Google OAuth │
│          │◀────────│  /connect │◀────────│  Consent    │
└─────────┘         └──────────┘         └─────────────┘
                          │
                          ▼
                    Store refresh_token
                    in AgentIntegration
                    (encrypted)
```

1. User clicks "Connect Google Workspace" in dashboard
2. Redirect to Google OAuth consent (scopes: gmail, calendar, drive, sheets, docs)
3. Exchange code for refresh token
4. Store encrypted refresh token in `AgentIntegration` (type: `google_workspace`)
5. MCP server uses the refresh token to make API calls on behalf of the user

### Required Google OAuth Scopes

```
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/documents
```

---

## Dependencies

```bash
# MCP SDK (client only — no server needed)
bun add @modelcontextprotocol/sdk

# Community MCP servers are invoked via npx at runtime, no install needed.
# They are spawned as child processes with stdio transport.
```

---

## Configuration (per environment)

```env
# .env
MCP_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
MCP_GOOGLE_CLIENT_SECRET=your-client-secret
MCP_GOOGLE_REDIRECT_URI=https://app.renovix.ai/api/integrations/google/callback
```

---

## Agent Configuration Example

In the dashboard, when creating/editing an agent:

```json
{
  "name": "Executive Assistant",
  "systemPrompt": "You are an executive assistant with access to Google Workspace...",
  "tools": ["knowledge_retrieval", "memory_store"],
  "mcpServers": [
    {
      "id": "google-workspace",
      "allowedTools": [
        "gmail_send",
        "gmail_search",
        "gcalendar_create_event",
        "gcalendar_list_events",
        "gdrive_list"
      ]
    }
  ]
}
```

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Token storage | Encrypt OAuth tokens at rest (AES-256-GCM) |
| Tool scoping | Per-agent `allowedTools` restricts which MCP tools are exposed |
| User consent | Explicit OAuth consent per Google Workspace scope |
| Rate limiting | Apply per-user rate limits on MCP tool calls |
| Sandboxing | stdio MCP servers run as child processes; no shared memory |
| Input validation | MCP SDK validates tool inputs against JSON Schema |
| Audit logging | Log all MCP tool calls to `AgentMessage` (role: "tool") |

---

## Available Community MCP Servers

| Server | Package | Description |
|--------|---------|-------------|
| Google Workspace | `@gongrzhe/server-gmail-autoauth-mcp`, `@adenot/google-calendar-mcp`, `@anthropic/mcp-google-drive` | Gmail, Calendar, Drive, Docs, Sheets |
| GitHub | `@modelcontextprotocol/server-github` | Issues, PRs, repos, files |
| Slack | `@modelcontextprotocol/server-slack` | Messages, channels |
| Notion | `@modelcontextprotocol/server-notion` | Pages, databases |
| Linear | `@modelcontextprotocol/server-linear` | Issues, projects |
| Brave Search | `@modelcontextprotocol/server-brave-search` | Web search |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Query databases |
| Filesystem | `@modelcontextprotocol/server-filesystem` | File operations |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | Web scraping |
| Memory | `@modelcontextprotocol/server-memory` | Persistent memory |

---

## Migration Path

1. **Keep existing integrations working** — The current `jira_create_ticket`, `slack_send_message`, etc. continue to work as built-in tools
2. **Add MCP as an additional layer** — New integrations use MCP; old ones can be migrated gradually
3. **Eventually deprecate built-in integrations** — Once MCP equivalents are stable, mark old tools as deprecated

---

## File Structure

```
apps/api/src/app/mcp/
├── mcp.module.ts              # NestJS module
├── mcp-client.service.ts      # MCP client (connect, list tools, call tools)
├── mcp-registry.service.ts    # Maps services to community MCP packages
├── mcp.controller.ts          # REST endpoints for managing MCP configs
└── dto/
    ├── create-mcp-server.dto.ts
    └── update-mcp-server.dto.ts
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mcp/servers` | List available MCP servers |
| `POST` | `/api/mcp/servers` | Add MCP server config |
| `GET` | `/api/mcp/servers/:id/tools` | Discover tools from a server |
| `POST` | `/api/mcp/servers/:id/test` | Test connection to MCP server |
| `POST` | `/api/agents/:id/mcp` | Attach MCP server to agent |
| `DELETE` | `/api/agents/:id/mcp/:serverId` | Detach MCP server |
| `GET` | `/api/integrations/google/connect` | Start Google OAuth flow |
| `GET` | `/api/integrations/google/callback` | OAuth callback |

---

## Frontend Strategy

### Pages & Routes

```
/dashboard/integrations              → MCP server marketplace + connected services
/dashboard/integrations/connect/:id  → OAuth flow / token input for a specific service
/dashboard/agents/:id/tools          → Agent tool configuration (built-in + MCP)
```

### 1. Integrations Page (`/dashboard/integrations`)

Displays available MCP servers as cards with connection status.

```tsx
// apps/dashboard/src/app/integrations/page.tsx

interface IntegrationCard {
  id: string;
  name: string;
  icon: string;          // e.g. "/icons/google-workspace.svg"
  description: string;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt?: string;
  tools: string[];       // available tools from this server
}
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Integrations                              [+ Add Custom] │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 🟢 Google    │  │ 🔴 GitHub    │  │ 🔴 Slack     │   │
│  │ Workspace    │  │              │  │              │   │
│  │ Connected    │  │ [Connect]    │  │ [Connect]    │   │
│  │ 13 tools     │  │ 5 tools      │  │ 4 tools      │   │
│  │ [Manage]     │  │              │  │              │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 🔴 Notion    │  │ 🔴 Linear    │  │ 🔴 Jira      │   │
│  │              │  │              │  │              │   │
│  │ [Connect]    │  │ [Connect]    │  │ [Connect]    │   │
│  │ 4 tools      │  │ 6 tools      │  │ 5 tools      │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 2. Connection Flow

**OAuth-based (Google, GitHub, Slack, Notion):**
```
[Connect] button → GET /api/integrations/:provider/connect
                 → Redirect to provider OAuth consent
                 → Callback → store token → redirect back with ?connected=true
```

**Token-based (Linear, Jira):**
```
[Connect] button → Modal with token input field
                 → POST /api/mcp/servers { name, env: { token } }
                 → Test connection → show success/error
```

```tsx
// apps/dashboard/src/components/integrations/connect-modal.tsx

function ConnectTokenModal({ provider, onSuccess }) {
  const [token, setToken] = useState('');
  const mutation = useMutation({
    mutationFn: (data) => api.post('/mcp/servers', data),
    onSuccess,
  });

  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {provider.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>API Token</Label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={`Enter your ${provider.name} token`}
            />
            <p className="text-sm text-muted-foreground mt-1">
              {provider.tokenHelpText}
            </p>
          </div>
          <Button
            onClick={() => mutation.mutate({
              name: provider.id,
              transport: 'stdio',
              command: 'npx',
              args: ['-y', provider.package],
              env: { [`${provider.envKey}`]: token },
            })}
            disabled={!token || mutation.isPending}
          >
            {mutation.isPending ? 'Testing...' : 'Connect & Test'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 3. Agent Tool Configuration (`/dashboard/agents/:id/tools`)

When editing an agent, a "Tools" tab lets users:
1. Toggle built-in tools (calculator, web_search, knowledge_retrieval, etc.)
2. Attach MCP servers and select which tools from each server the agent can use

```
┌─────────────────────────────────────────────────────────┐
│  Agent: Executive Assistant    [General] [Tools] [KB]    │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Built-in Tools                                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │ ☑ knowledge_retrieval   ☑ memory_store          │     │
│  │ ☑ calculator            ☐ web_search            │     │
│  │ ☐ code_exec             ☑ delegate_to_subagent  │     │
│  └─────────────────────────────────────────────────┘     │
│                                                           │
│  MCP Integrations                     [+ Add Integration] │
│  ┌─────────────────────────────────────────────────┐     │
│  │ 🟢 Google Workspace                    [Remove] │     │
│  │   ☑ gmail_send         ☑ gmail_search           │     │
│  │   ☑ gcalendar_create   ☑ gcalendar_list         │     │
│  │   ☐ gdrive_list        ☐ gdrive_read            │     │
│  │   ☐ gsheets_read       ☐ gsheets_write          │     │
│  ├─────────────────────────────────────────────────┤     │
│  │ 🟢 GitHub                              [Remove] │     │
│  │   ☑ create_issue       ☑ search_repositories    │     │
│  │   ☐ create_pull_request ☐ get_file_contents     │     │
│  └─────────────────────────────────────────────────┘     │
│                                                           │
│                                          [Save Changes]   │
└─────────────────────────────────────────────────────────┘
```

```tsx
// apps/dashboard/src/components/agents/agent-mcp-tools.tsx

function AgentMcpTools({ agentId }) {
  const { data: connectedServers } = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => api.get('/mcp/servers'),
  });

  const { data: agentMcp } = useQuery({
    queryKey: ['agents', agentId, 'mcp'],
    queryFn: () => api.get(`/agents/${agentId}/mcp`),
  });

  const attachMutation = useMutation({
    mutationFn: (data: { mcpServerId: string; allowedTools: string[] }) =>
      api.post(`/agents/${agentId}/mcp`, data),
    onSuccess: () => queryClient.invalidateQueries(['agents', agentId, 'mcp']),
  });

  const updateToolsMutation = useMutation({
    mutationFn: ({ serverId, tools }: { serverId: string; tools: string[] }) =>
      api.patch(`/agents/${agentId}/mcp/${serverId}`, { allowedTools: tools }),
    onSuccess: () => queryClient.invalidateQueries(['agents', agentId, 'mcp']),
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">MCP Integrations</h3>
        <AddIntegrationDropdown
          servers={connectedServers}
          attached={agentMcp}
          onAttach={(serverId) => attachMutation.mutate({ mcpServerId: serverId, allowedTools: [] })}
        />
      </div>

      {agentMcp?.map((mcp) => (
        <McpServerToolSelector
          key={mcp.id}
          server={mcp.mcpServer}
          selectedTools={mcp.allowedTools || []}
          onToggleTool={(tools) =>
            updateToolsMutation.mutate({ serverId: mcp.mcpServerId, tools })
          }
        />
      ))}
    </div>
  );
}
```

### 4. React Query Hooks

```tsx
// apps/dashboard/src/hooks/use-mcp.ts

export function useMcpServers() {
  return useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => api.get<McpServer[]>('/mcp/servers'),
  });
}

export function useMcpServerTools(serverId: string) {
  return useQuery({
    queryKey: ['mcp-servers', serverId, 'tools'],
    queryFn: () => api.get<McpTool[]>(`/mcp/servers/${serverId}/tools`),
    enabled: !!serverId,
  });
}

export function useConnectMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMcpServerDto) => api.post('/mcp/servers', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-servers'] }),
  });
}

export function useTestMcpConnection(serverId: string) {
  return useMutation({
    mutationFn: () => api.post(`/mcp/servers/${serverId}/test`),
  });
}

export function useAgentMcpServers(agentId: string) {
  return useQuery({
    queryKey: ['agents', agentId, 'mcp'],
    queryFn: () => api.get<AgentMcpServer[]>(`/agents/${agentId}/mcp`),
    enabled: !!agentId,
  });
}
```

### 5. Types

```tsx
// apps/dashboard/src/types/mcp.ts

export interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  isGlobal: boolean;
  status: 'connected' | 'disconnected' | 'error';
  createdAt: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface AgentMcpServer {
  id: string;
  mcpServerId: string;
  mcpServer: McpServer;
  allowedTools: string[] | null; // null = all tools allowed
}

export interface CreateMcpServerDto {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}
```

### 6. Chat UI — Tool Call Display

When the agent uses an MCP tool during a conversation, show it inline:

```tsx
// apps/chat/src/components/tool-call-card.tsx

function ToolCallCard({ toolCall }: { toolCall: ToolCallMessage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg p-3 my-2 bg-muted/50">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <ToolIcon name={toolCall.name} />
        <span className="font-medium text-sm">{formatToolName(toolCall.name)}</span>
        <Badge variant="outline" className="text-xs">
          {toolCall.duration}ms
        </Badge>
        <ChevronDown className={cn("ml-auto h-4 w-4", expanded && "rotate-180")} />
      </div>
      {expanded && (
        <div className="mt-2 space-y-2">
          <div>
            <span className="text-xs text-muted-foreground">Input:</span>
            <pre className="text-xs bg-background p-2 rounded mt-1">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Result:</span>
            <pre className="text-xs bg-background p-2 rounded mt-1">
              {toolCall.result}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Timeline

| Phase | Scope | Effort |
|-------|-------|--------|
| 1 | MCP Client SDK integration + stdio transport | Small |
| 2 | Database schema + CRUD endpoints | Small |
| 3 | Agent tool loop integration (discovery + execution) | Medium |
| 4 | Google Workspace MCP server (self-hosted) | Medium |
| 5 | OAuth flow + dashboard UI for connecting services | Medium |
| 5a | Integrations page + connection modals | Medium |
| 5b | Agent tool configuration UI | Small |
| 5c | Chat tool call display | Small |
| 6 | Migrate existing integrations to MCP | Large (optional) |
