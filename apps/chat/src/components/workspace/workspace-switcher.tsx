"use client";

import { useShellWorkspaces } from "@/hooks/use-shell-workspaces";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function WorkspaceSwitcher() {
  const { workspaces, selected, setActiveWorkspace } = useShellWorkspaces();
  return (
    <Select value={selected?.id ?? "personal"} onValueChange={(id) => setActiveWorkspace(id === "personal" ? null : id)}>
      <SelectTrigger aria-label="Workspace" className="w-full min-w-0"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="personal">Personal workspace</SelectItem>
        {workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
