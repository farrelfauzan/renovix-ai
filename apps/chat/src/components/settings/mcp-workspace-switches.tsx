"use client";

import { McpWorkspaceSwitch } from "@/components/settings/mcp-workspace-switch";
import type { Workspace } from "@/lib/workspace-types";

interface McpWorkspaceSwitchesProps {
  provider: string;
  /** The shared workspaces of the user; the default workspace is never in this list. */
  workspaces: Workspace[];
  enabledWorkspaceIds: string[];
}

/** The switches under a connected provider, one per shared workspace. */
export function McpWorkspaceSwitches({
  provider,
  workspaces,
  enabledWorkspaceIds,
}: McpWorkspaceSwitchesProps) {
  if (workspaces.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">Use in workspaces</p>
      {workspaces.map((workspace) => (
        <McpWorkspaceSwitch
          key={workspace.id}
          provider={provider}
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          isOn={enabledWorkspaceIds.includes(workspace.id)}
        />
      ))}
    </div>
  );
}
