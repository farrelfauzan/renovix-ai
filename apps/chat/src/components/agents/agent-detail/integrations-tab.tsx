"use client";

import {
  Loader2,
  CheckCircle2,
  XCircle,
  TestTube,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useMcpServers,
  useTestMcpConnection,
} from "@/hooks/use-mcp";
import { IntegrationProviderLogo } from "@/components/agents/agent-detail/integration-provider-logo";

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

type IntegrationsTabProps = {
  agent: any;
  agentId: string;
};

export function IntegrationsTab({ agent, agentId }: IntegrationsTabProps) {
  const { data: servers, isLoading } = useMcpServers();
  const testConn = useTestMcpConnection();

  const handleTest = async (credentialId: string, name: string) => {
    try {
      await testConn.mutateAsync(credentialId);
      toast.success(`${name} connection OK`);
    } catch {
      toast.error(`${name} connection failed`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3">
          <h3 className="text-sm font-medium">Connected Integrations</h3>
          <p className="text-xs text-muted-foreground">
            All your connected MCP services are automatically available to this agent at runtime.
            Manage connections in Agent Settings.
          </p>
        </div>

        {(!servers || servers.length === 0) ? (
          <div className="border border-dashed rounded-lg p-6 text-center">
            <Settings className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No integrations connected yet. Open Agent Settings to connect services.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {servers.map((server) => (
              <div
                key={server.id}
                className="border rounded-lg p-3 flex items-center justify-between"
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
                      {server.transport} · All tools enabled
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
                    {server.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleTest(server.id, server.displayName)}
                    title="Test connection"
                  >
                    <TestTube className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
