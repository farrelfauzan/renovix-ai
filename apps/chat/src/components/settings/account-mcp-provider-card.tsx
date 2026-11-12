"use client";

import { CheckCircle2, ExternalLink, LogOut, XCircle } from "lucide-react";
import { Badge } from "@performa-ai/ui/components/badge";
import { Button } from "@performa-ai/ui/components/button";
import { IntegrationProviderLogo } from "@/components/agents/agent-detail/integration-provider-logo";
import { McpWorkspaceSwitches } from "@/components/settings/mcp-workspace-switches";
import { MCP_LOGOS } from "@/lib/mcp-logos";
import type { AccountMcpCredential } from "@/hooks/use-user-mcp";
import type { McpRegistryEntry } from "@/lib/mcp-types";
import type { Workspace } from "@/lib/workspace-types";

interface AccountMcpProviderCardProps {
  entry: McpRegistryEntry;
  /** The account connection of this provider; undefined when not connected. */
  credential: AccountMcpCredential | undefined;
  workspaces: Workspace[];
  onConnectAction: () => void;
  onDisconnectAction: () => void;
}

/** One provider on the connected-tools screen: account status, Connect or Disconnect, and the workspace switches. */
export function AccountMcpProviderCard({
  entry,
  credential,
  workspaces,
  onConnectAction,
  onDisconnectAction,
}: AccountMcpProviderCardProps) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <IntegrationProviderLogo name={entry.displayName} logoUrl={MCP_LOGOS[entry.name] || ""} size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{entry.displayName}</p>
            {credential ? (
              <Badge variant="outline" className="mt-0.5 border-rx-green/30 text-xs text-rx-green">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="mt-0.5 border-muted text-xs text-muted-foreground">
                <XCircle className="mr-1 h-3 w-3" />
                Not connected
              </Badge>
            )}
          </div>
        </div>
        {credential ? (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDisconnectAction}>
            <LogOut className="mr-1 h-3.5 w-3.5" />
            Disconnect
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onConnectAction}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Connect
          </Button>
        )}
      </div>
      {credential && (
        <McpWorkspaceSwitches
          provider={entry.name}
          workspaces={workspaces}
          enabledWorkspaceIds={credential.workspaceIds}
        />
      )}
    </div>
  );
}
