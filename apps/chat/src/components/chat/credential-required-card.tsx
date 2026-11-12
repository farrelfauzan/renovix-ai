"use client";

import { ExternalLink, KeyRound, Power } from "lucide-react";
import { Button } from "@performa-ai/ui/components/button";
import {
  useAccountMcpCredentials,
  useEnableMcpInWorkspace,
  useStartUserOAuth,
} from "@/hooks/use-user-mcp";
import { useShellWorkspaces } from "@/hooks/use-shell-workspaces";
import { toast } from "sonner";

const PROVIDER_LABELS: Record<string, string> = {
  "google-gmail": "Google Gmail",
  "google-calendar": "Google Calendar",
  "google-sheets": "Google Sheets",
  github: "GitHub",
  slack: "Slack",
};

interface CredentialRequiredCardProps {
  provider: string;
  workspaceId: string | null;
}

/**
 * Inline card shown in chat when an agent needs a tool
 * that the user hasn't connected yet.
 */
export function CredentialRequiredCard({
  provider,
  workspaceId,
}: CredentialRequiredCardProps) {
  const startOAuth = useStartUserOAuth();
  const enable = useEnableMcpInWorkspace();
  const { data: credentials } = useAccountMcpCredentials();
  const { workspaces } = useShellWorkspaces();
  const label = PROVIDER_LABELS[provider] || provider;

  // RNX-293: connected on the account but off in this (shared) workspace: offer the switch, not a new connect.
  const credential = credentials?.find((c) => c.provider === provider);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const isOnHere = !!credential && !!workspace && credential.workspaceIds.includes(workspace.id);
  const canTurnOn = !!credential && !!workspace && !isOnHere;

  const handleTurnOn = () => {
    if (!workspace) return;
    enable.mutate(
      { provider, workspaceId: workspace.id },
      { onError: () => toast.error(`Could not turn ${label} on in ${workspace.name}`) },
    );
  };

  const handleConnect = async () => {
    if (!workspaceId) {
      toast.error("No workspace context available");
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

  return (
    <div className="border rounded-lg p-4 bg-rx-amber-tint border-rx-amber-bar/30 max-w-md">
      <div className="flex items-start gap-3">
        <KeyRound className="h-5 w-5 text-rx-amber-text shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm font-medium text-rx-amber-text">
            Connection required
          </p>
          <p className="text-xs text-rx-amber-text">
            This action requires access to your {label} account. Connect it to
            allow the agent to perform this task on your behalf.
          </p>
          {isOnHere ? (
            <p className="text-xs font-medium text-rx-amber-text">
              {label} is on in {workspace?.name}. Ask the agent again.
            </p>
          ) : canTurnOn ? (
            <Button
              size="sm"
              variant="outline"
              className="border-rx-amber-bar/40 hover:bg-rx-amber-tint"
              onClick={handleTurnOn}
              disabled={enable.isPending}
            >
              <Power className="h-3.5 w-3.5 mr-1.5" />
              Turn on in {workspace?.name}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="border-rx-amber-bar/40 hover:bg-rx-amber-tint"
              onClick={handleConnect}
              disabled={startOAuth.isPending || !workspaceId}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Connect {label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
