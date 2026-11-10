"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import {
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  TestTube,
} from "lucide-react";
import { Badge } from "@performa-ai/ui/components/badge";
import { Button } from "@performa-ai/ui/components/button";
import {
  useMcpServers,
  useMcpRegistry,
  useDeleteMcpServer,
  useTestMcpConnection,
} from "@/hooks/use-mcp";
import { McpConnectDialog } from "@/components/integrations/mcp-connect-dialog";
import { useChannelWorkspace, useCreateChannelWorkspace } from "@/hooks/use-workspaces";
import { IntegrationProviderLogo } from "@/components/agents/agent-detail/integration-provider-logo";
import { UserMcpConnections } from "@/components/settings/user-mcp-connections";
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

export function WorkspaceIntegrations({ channelId }: { channelId: string }) {
  const [connectProvider, setConnectProvider] = useState<McpRegistryEntry | null>(null);
  const searchParams = useSearchParams();

  const { data: servers, isLoading: serversLoading } = useMcpServers();
  const { data: registry } = useMcpRegistry();
  const deleteMcp = useDeleteMcpServer();
  const testConn = useTestMcpConnection();
  const { data: wsData } = useChannelWorkspace(channelId);
  const createWorkspace = useCreateChannelWorkspace();
  const workspaceId = wsData?.workspace?.id ?? null;
  const workspaceReady = !!workspaceId;
  const didCreateRef = useRef(false);

  console.log("[WorkspaceIntegrations]", { channelId, wsData, workspaceId });

  // Auto-create workspace if channel doesn't have one yet
  useEffect(() => {
    if (wsData && !wsData.exists && !didCreateRef.current) {
      didCreateRef.current = true;
      createWorkspace.mutate(channelId);
    }
  }, [wsData, channelId, createWorkspace]);

  // Handle OAuth redirect result
  useEffect(() => {
    const oauthResult = searchParams.get("oauth");
    if (oauthResult === "success") {
      toast.success("Integration connected successfully!");
    } else if (oauthResult === "error") {
      const message = searchParams.get("message") || "Authorization failed";
      toast.error(message);
    }
  }, [searchParams]);

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

  return (
    <div className="space-y-6">
      {/* Per-User Connections (OAuth via platform) */}
      <section>
        <UserMcpConnections workspaceId={workspaceId} />
      </section>

      <div className="border-t" />

      {/* Connected MCP Servers (token-based / custom) */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium">Custom MCP Servers</h3>
            <p className="text-xs text-muted-foreground">
              Token-based MCP servers shared across the workspace. For personal OAuth services, use &quot;My Integrations&quot; above.
            </p>
          </div>
        </div>

        {(!servers || servers.length === 0) ? (
          <div className="border border-dashed rounded-lg p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No services connected yet. Add one from the available integrations below.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((server) => (
              <div
                key={server.id}
                className="border rounded-lg p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <IntegrationProviderLogo
                    name={server.displayName}
                    logoUrl={MCP_LOGOS[server.name] || ""}
                    size="sm"
                  />
                  <div>
                    <p className="font-medium text-sm">{server.displayName}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {server.transport} transport
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
                    className="h-8 w-8"
                    onClick={() => handleTest(server.id, server.displayName)}
                    disabled={testConn.isPending}
                    title="Test connection"
                  >
                    <TestTube className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect(server.id, server.displayName)}
                    disabled={deleteMcp.isPending}
                    title="Disconnect"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Registry - Available to Connect (only token-based, not OAuth providers) */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium">Available Integrations</h3>
            <p className="text-xs text-muted-foreground">
              Add a custom token-based MCP server. Once connected, you can attach it to any agent.
            </p>
          </div>
        </div>
        {!workspaceReady && (
          <div className="border border-dashed rounded-lg p-3 mb-3">
            <p className="text-xs text-muted-foreground">
              Workspace is required before connecting integrations.
            </p>
          </div>
        )}
        {(() => {
          const oauthProviderNames = ["google-gmail", "google-calendar", "google-sheets", "github", "slack"];
          const availableEntries = (registry || []).filter(
            (entry) =>
              !servers?.some((s) => s.name === entry.name) &&
              !oauthProviderNames.includes(entry.name)
          );
          if (availableEntries.length === 0) {
            return (
              <div className="border border-dashed rounded-lg p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  All available integrations are already connected.
                </p>
              </div>
            );
          }
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {availableEntries.map((entry) => (
                <div
                  key={entry.name}
                  className={`border rounded-lg p-3 flex items-center justify-between ${
                    workspaceReady ? "" : "opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <IntegrationProviderLogo
                      name={entry.displayName}
                      logoUrl={MCP_LOGOS[entry.name] || ""}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{entry.displayName}</p>
                      <p className="text-xs text-muted-foreground truncate">
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
          );
        })()}
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
  );
}
