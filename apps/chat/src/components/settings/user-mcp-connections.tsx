"use client";

import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  LogOut,
  ExternalLink,
  Info,
} from "lucide-react";
import { Badge } from "@performa-ai/ui/components/badge";
import { Button } from "@performa-ai/ui/components/button";
import {
  useUserMcpCredentials,
  useStartUserOAuth,
  useDisconnectUserMcp,
} from "@/hooks/use-user-mcp";
import { useMcpRegistry } from "@/hooks/use-mcp";
import { IntegrationProviderLogo } from "@/components/agents/agent-detail/integration-provider-logo";

const MCP_LOGOS: Record<string, string> = {
  "google-gmail":
    "https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png",
  "google-calendar":
    "https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png",
  "google-sheets":
    "https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png",
  github: "https://github.com/fluidicon.png",
  slack: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
  notion: "https://www.notion.so/front-static/favicon.ico",
};

// Providers that support per-user OAuth
const OAUTH_PROVIDERS = [
  "google-gmail",
  "google-calendar",
  "google-sheets",
  "github",
  "slack",
];

interface UserMcpConnectionsProps {
  workspaceId: string | null;
}

export function UserMcpConnections({ workspaceId }: UserMcpConnectionsProps) {
  const { data: credentials, isLoading } = useUserMcpCredentials(workspaceId);
  const { data: registry } = useMcpRegistry();
  const startOAuth = useStartUserOAuth();
  const disconnect = useDisconnectUserMcp();

  const connectedProviders = new Set(credentials?.map((c) => c.provider) || []);

  const handleConnect = async (provider: string) => {
    if (!workspaceId) {
      toast.error("No workspace selected");
      return;
    }
    try {
      const { authUrl } = await startOAuth.mutateAsync({
        provider,
        workspaceId,
      });
      window.location.href = authUrl;
    } catch {
      toast.error("Failed to start authorization");
    }
  };

  const handleDisconnect = async (provider: string, displayName: string) => {
    if (!workspaceId) return;
    try {
      await disconnect.mutateAsync({ provider, workspaceId });
      toast.success(`${displayName} disconnected`);
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Filter registry to only OAuth-capable providers
  const oauthEntries = (registry || []).filter((entry) =>
    OAUTH_PROVIDERS.includes(entry.name),
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">My Integrations</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Connect your personal accounts to use tools with workspace agents.
          Each member connects their own accounts.
        </p>
      </div>

      {/* Provider cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {oauthEntries.map((entry) => {
          const isConnected = connectedProviders.has(entry.name);
          const credential = credentials?.find(
            (c) => c.provider === entry.name,
          );

          return (
            <div
              key={entry.name}
              className="border rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3 min-w-0">
                <IntegrationProviderLogo
                  name={entry.displayName}
                  logoUrl={MCP_LOGOS[entry.name] || ""}
                  size="sm"
                />
                <div className="min-w-0">
                  <p className="font-medium text-sm">{entry.displayName}</p>
                  {isConnected && credential ? (
                    <Badge
                      variant="outline"
                      className="text-rx-green border-rx-green/30 text-xs mt-0.5"
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-muted-foreground border-muted text-xs mt-0.5"
                    >
                      <XCircle className="h-3 w-3 mr-1" />
                      Not connected
                    </Badge>
                  )}
                </div>
              </div>

              <div className="shrink-0 ml-2">
                {isConnected ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() =>
                      handleDisconnect(entry.name, entry.displayName)
                    }
                    disabled={disconnect.isPending}
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1" />
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect(entry.name)}
                    disabled={startOAuth.isPending || !workspaceId}
                  >
                    {startOAuth.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    )}
                    Connect
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Info notice */}
      <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Your credentials are encrypted and only used when you interact with
          agents. We never access your accounts without your action.
        </p>
      </div>
    </div>
  );
}
