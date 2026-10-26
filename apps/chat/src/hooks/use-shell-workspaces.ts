"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useAuthStore, useHydrated } from "@/lib/stores";
import type { Workspace } from "@/lib/workspace-types";

export function useShellWorkspaces() {
  const hydrated = useHydrated();
  const { isLoggedIn } = useAuthStore();
  const { activeWorkspaceId, setActiveWorkspace } = useWorkspaceStore();
  const list = useQuery({
    queryKey: ["shell-workspaces"],
    queryFn: () => apiClient.get<Workspace[]>("/workspaces"),
    enabled: hydrated && isLoggedIn(),
  });
  // A persisted id alone is never a capability or a valid selection.
  const selected = list.data?.find((workspace) => workspace.id === activeWorkspaceId);
  const detail = useQuery({
    queryKey: ["shell-workspace", selected?.id],
    queryFn: () => apiClient.get<Workspace & { collaborationAllowed: boolean; effectiveRole: "owner" | "member" }>(`/workspaces/${selected!.id}`),
    enabled: !!selected,
  });
  return { workspaces: list.data ?? [], selected, capability: detail.data, setActiveWorkspace };
}
