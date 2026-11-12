"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AccountMcpProviderCard } from "@/components/settings/account-mcp-provider-card";
import { McpDisconnectDialog } from "@/components/settings/mcp-disconnect-dialog";
import { McpConnectDialog } from "@/components/integrations/mcp-connect-dialog";
import { useShellWorkspaces } from "@/hooks/use-shell-workspaces";
import { useMcpRegistry } from "@/hooks/use-mcp";
import {
  useAccountMcpCredentials,
  useDisconnectUserMcp,
} from "@/hooks/use-user-mcp";
import type { McpRegistryEntry } from "@/lib/mcp-types";

/**
 * Connected tools (RNX-293, D312): connect each provider once per account, then switch it on or off per shared
 * workspace. Shows the same whatever workspace the shell has selected.
 */
export function AccountMcpConnections() {
  const { data: credentials, isLoading } = useAccountMcpCredentials();
  const { data: registry } = useMcpRegistry();
  const { workspaces } = useShellWorkspaces();
  const disconnect = useDisconnectUserMcp();
  const [connecting, setConnecting] = useState<McpRegistryEntry | null>(null);
  const [disconnecting, setDisconnecting] = useState<McpRegistryEntry | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const disconnectingIds = credentials?.find((c) => c.provider === disconnecting?.name)?.workspaceIds ?? [];
  const disconnectingNames = workspaces
    .filter((workspace) => disconnectingIds.includes(workspace.id))
    .map((workspace) => workspace.name);

  const handleDisconnect = async () => {
    if (!disconnecting) return;
    try {
      await disconnect.mutateAsync({ provider: disconnecting.name });
      toast.success(`${disconnecting.displayName} disconnected`);
    } catch {
      toast.error("Failed to disconnect");
    }
    setDisconnecting(null);
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Connect each tool once for your account, then switch it on in the workspaces where agents may use it.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(registry ?? []).map((entry) => (
          <AccountMcpProviderCard
            key={entry.name}
            entry={entry}
            credential={credentials?.find((c) => c.provider === entry.name)}
            workspaces={workspaces}
            onConnectAction={() => setConnecting(entry)}
            onDisconnectAction={() => setDisconnecting(entry)}
          />
        ))}
      </div>
      {connecting && (
        <McpConnectDialog
          provider={connecting}
          workspaceId={null}
          open
          onOpenChangeAction={(open) => !open && setConnecting(null)}
        />
      )}
      {disconnecting && (
        <McpDisconnectDialog
          displayName={disconnecting.displayName}
          workspaceNames={disconnectingNames}
          open
          onOpenChangeAction={(open) => !open && setDisconnecting(null)}
          onConfirmAction={handleDisconnect}
        />
      )}
    </div>
  );
}
