"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  TestTube,
  Plug,
  Settings2,
} from "lucide-react";
import { Badge } from "@performa-ai/ui/components/badge";
import { Button } from "@performa-ai/ui/components/button";
import {
  useMcpServers,
  useMcpRegistry,
  useDeleteMcpServer,
  useTestMcpConnection,
} from "@/hooks/use-mcp";
import {
  useChannelWorkspace,
  useCreateChannelWorkspace,
} from "@/hooks/use-workspaces";
import { McpConnectDialog } from "@/components/integrations/mcp-connect-dialog";
import { IntegrationProviderLogo } from "@/components/agents/agent-detail/integration-provider-logo";
import type { McpRegistryEntry } from "@/lib/mcp-types";

const MCP_LOGOS: Record<string, string> = {
  "google-gmail": "https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png",
  "google-calendar": "https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png",
  "google-drive": "https://www.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png",
  "google-sheets": "https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png",
  github: "https://github.com/fluidicon.png",
  slack: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
  notion: "https://www.notion.so/front-static/favicon.ico",
  linear: "https://linear.app/favicon.ico",
  "brave-search": "https://brave.com/static-assets/images/brave-logo-sans-text.svg",
};

export function AgentSettingsPanel({ channelId }: { channelId: string | null }) {
  const [connectProvider, setConnectProvider] = useState<McpRegistryEntry | null>(null);
  const didCreateWorkspaceRef = useRef(false);

  const { data: servers, isLoading: serversLoading } = useMcpServers();
  const { data: registry } = useMcpRegistry();
  const deleteMcp = useDeleteMcpServer();
  const testConn = useTestMcpConnection();
  const { data: wsData } = useChannelWorkspace(channelId);
  const createWorkspace = useCreateChannelWorkspace();
  const workspaceId = wsData?.workspace?.id ?? null;
  const workspaceReady = !!workspaceId;

  // Ensure a workspace exists for the selected server so OAuth integrations can connect.
  useEffect(() => {
    if (channelId && wsData && !wsData.exists && !didCreateWorkspaceRef.current) {
      didCreateWorkspaceRef.current = true;
      createWorkspace.mutate(channelId);
    }
  }, [channelId, wsData, createWorkspace]);

  const handleTest = async (serverId: string, name: string) => {
    try {
      await testConn.mutateAsync(serverId);
      toast.success(`${name} connection OK`);
    } catch {
      toast.error(`${name} connection failed`);
    }
  };

  const handleDisconnect = async (serverId: string, name: string) => {
    try {
      await deleteMcp.mutateAsync(serverId);
      toast.success(`${name} disconnected`);
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  if (serversLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const connectedNames = new Set(servers?.map((s) => s.name) || []);
  const availableEntries = (registry || []).filter(
    (entry) => !connectedNames.has(entry.name)
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Agent Settings</h2>
            <p className="text-xs text-muted-foreground">
              Manage your MCP tools globally. Connected services here can be attached to any agent in any server.
            </p>
          </div>
        </div>

        {/* Connected MCP Servers */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Plug className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Connected MCP Servers</h3>
            <Badge variant="outline" className="text-[10px] ml-auto">
              {servers?.length || 0} Connected
            </Badge>
          </div>

          {(!servers || servers.length === 0) ? (
            <div className="border border-dashed border-border rounded-lg p-6 text-center">
              <Plug className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No MCP servers connected yet. Add one below to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="border border-border rounded-lg bg-muted"
                >
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <IntegrationProviderLogo
                        name={server.displayName}
                        logoUrl={MCP_LOGOS[server.name] || ""}
                        size="sm"
                      />
                      <div>
                        <p className="font-medium text-sm text-foreground">
                          {server.displayName}
                        </p>
                        <p className="text-[11px] text-muted-foreground capitalize">
                          {server.transport} · {server.isGlobal ? "Global" : "Workspace"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          server.status === "connected"
                            ? "text-rx-green border-rx-green/30"
                            : "text-destructive border-destructive/30"
                        }
                      >
                        {server.status === "connected" ? (
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                        ) : (
                          <XCircle className="h-3 w-3 mr-1" />
                        )}
                        {server.status.replace(/^\w/, (c) => c.toUpperCase())}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => handleTest(server.id, server.displayName)}
                        disabled={testConn.isPending}
                        title="Test connection"
                      >
                        <TestTube className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-rx-red-tint"
                        onClick={() => handleDisconnect(server.id, server.displayName)}
                        disabled={deleteMcp.isPending}
                        title="Disconnect"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Available Integrations */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Plus className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Available Integrations</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Connect MCP servers here. OAuth providers (Google/GitHub/Slack)
            use your per-user account for the selected server.
          </p>

          {!workspaceReady && (
            <div className="border border-dashed border-border rounded-lg p-3 mb-3">
              <p className="text-xs text-muted-foreground">
                Workspace is required before connecting integrations.
              </p>
            </div>
          )}

          {availableEntries.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg p-6 text-center">
              <p className="text-sm text-muted-foreground">
                All available integrations are already connected.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {availableEntries.map((entry) => (
                <div
                  key={entry.name}
                  className={`border border-border rounded-lg p-3 flex items-center justify-between transition-colors ${
                    workspaceReady
                      ? "bg-muted hover:bg-muted"
                      : "bg-muted opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <IntegrationProviderLogo
                      name={entry.displayName}
                      logoUrl={MCP_LOGOS[entry.name] || ""}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-foreground">
                        {entry.displayName}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {entry.description}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-2 shrink-0"
                    disabled={!workspaceReady}
                    onClick={() => setConnectProvider(entry)}
                    title={!workspaceReady ? "Create/select a workspace first" : "Connect"}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Connect
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {connectProvider && (
          <McpConnectDialog
            provider={connectProvider}
            workspaceId={workspaceId}
            open={!!connectProvider}
            onOpenChangeAction={(open) => !open && setConnectProvider(null)}
          />
        )}
      </div>
    </div>
  );
}
