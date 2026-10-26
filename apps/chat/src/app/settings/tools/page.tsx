"use client";

import { UserMcpConnections } from "@/components/settings/user-mcp-connections";
import { useShellWorkspaces } from "@/hooks/use-shell-workspaces";

export default function ToolsPage() {
  const { selected } = useShellWorkspaces();
  return <main className="min-w-0 p-4 sm:p-8"><h1 className="mb-6 text-xl font-semibold">Connected tools</h1><UserMcpConnections workspaceId={selected?.id ?? null} /></main>;
}
