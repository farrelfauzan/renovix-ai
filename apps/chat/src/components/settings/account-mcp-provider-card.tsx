"use client";

import { CheckCircle2, Link, Unlink, XCircle } from "lucide-react";
import { Badge } from "@performa-ai/ui/components/badge";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";
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
          <IconActionButton title="Disconnect" tone="destructive" label={`Disconnect ${entry.displayName}`} icon={Unlink} onClick={onDisconnectAction} />
        ) : (
          <IconActionButton title="Connect" label={`Connect ${entry.displayName}`} icon={Link} onClick={onConnectAction} />
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
