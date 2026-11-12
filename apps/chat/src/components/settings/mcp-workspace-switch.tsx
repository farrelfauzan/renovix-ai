"use client";

import { toast } from "sonner";
import { Switch } from "@performa-ai/ui/components/switch";
import {
  useDisableMcpInWorkspace,
  useEnableMcpInWorkspace,
} from "@/hooks/use-user-mcp";

interface McpWorkspaceSwitchProps {
  provider: string;
  workspaceId: string;
  workspaceName: string;
  isOn: boolean;
}

/** One workspace's switch for an account connection; it moves at once and goes back with a message on failure. */
export function McpWorkspaceSwitch({
  provider,
  workspaceId,
  workspaceName,
  isOn,
}: McpWorkspaceSwitchProps) {
  const enable = useEnableMcpInWorkspace();
  const disable = useDisableMcpInWorkspace();

  const handleChange = (next: boolean) => {
    const mutation = next ? enable : disable;
    mutation.mutate(
      { provider, workspaceId },
      {
        onError: () =>
          toast.error(
            `Could not turn ${next ? "on" : "off"} for ${workspaceName}. It stays ${next ? "off" : "on"}.`,
          ),
      },
    );
  };

  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate">{workspaceName}</span>
      <Switch
        checked={isOn}
        onCheckedChange={handleChange}
        aria-label={`${workspaceName}`}
      />
    </label>
  );
}
