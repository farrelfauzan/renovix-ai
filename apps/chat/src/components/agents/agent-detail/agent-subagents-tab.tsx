"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAgents, useUpdateAgent } from "@/hooks/use-agents";
import { Badge } from "@performa-ai/ui/components/badge";
import { Button } from "@performa-ai/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@performa-ai/ui/components/select";
import { Plus, X } from "lucide-react";

type AgentSubAgentsTabProps = {
  agent: any;
  agentId: string;
  onViewAgentAction: (agentId: string) => void;
};

export function AgentSubAgentsTab({
  agent,
  agentId,
  onViewAgentAction,
}: AgentSubAgentsTabProps) {
  const router = useRouter();
  const updateAgent = useUpdateAgent();
  const { data: allAgents } = useAgents();
  const [selectedSubAgent, setSelectedSubAgent] = useState<string>("");

  const canManageSubAgents = agent.agentType === "parent";
  const availableSubAgents = (allAgents || []).filter(
    (a: any) =>
      a.id !== agentId &&
      a.agentType !== "parent" &&
      !agent.subAgents?.some((s: any) => s.id === a.id),
  );

  const handleEnableSubAgents = async () => {
    try {
      await updateAgent.mutateAsync({
        id: agentId,
        data: { agentType: "parent", parentAgentId: null },
      });
      toast.success("Sub-agent mode enabled");
    } catch {
      toast.error("Failed to enable sub-agents");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground mb-4">
        Manage sub-agents that can handle delegated tasks.
      </p>

      {!canManageSubAgents && (
        <div className="rounded-lg border p-4 bg-muted/30">
          <p className="text-sm text-muted-foreground">
            This agent is currently <span className="font-medium">{agent.agentType}</span>. Enable sub-agent mode to start adding sub-agents.
          </p>
          <Button
            className="mt-3"
            onClick={handleEnableSubAgents}
            disabled={updateAgent.isPending}
          >
            Enable Sub-Agents
          </Button>
        </div>
      )}

      {canManageSubAgents && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select value={selectedSubAgent} onValueChange={setSelectedSubAgent}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select an agent to link as sub-agent" />
              </SelectTrigger>
              <SelectContent>
                {availableSubAgents.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={async () => {
                if (!selectedSubAgent) return;
                try {
                  await updateAgent.mutateAsync({
                    id: selectedSubAgent,
                    data: { parentAgentId: agentId, agentType: "sub_agent" },
                  });
                  setSelectedSubAgent("");
                  toast.success("Sub-agent linked");
                } catch {
                  toast.error("Failed to link sub-agent");
                }
              }}
              disabled={!selectedSubAgent}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>

          {availableSubAgents.length === 0 && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm text-muted-foreground">
              No eligible agents to link yet. Create a new sub-agent first.
              <Button
                variant="outline"
                size="sm"
                className="ml-3"
                onClick={() =>
                  router.push(
                    `/agents/new?agentType=sub_agent&parentAgentId=${agentId}`,
                  )
                }
              >
                Create Sub-Agent
              </Button>
            </div>
          )}
        </div>
      )}

      {!agent.subAgents || agent.subAgents.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          No sub-agents configured.
          {!canManageSubAgents && (
            <span className="block mt-2 text-xs">
              Enable sub-agent mode above to start linking sub-agents.
            </span>
          )}
        </p>
      ) : (
        agent.subAgents.map((sub: any) => (
          <div
            key={sub.id}
            className="flex items-center justify-between p-4 rounded-lg border"
          >
            <div>
              <p className="font-medium text-sm">{sub.name}</p>
              <Badge variant="outline" className="text-xs">
                {sub.status}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onViewAgentAction(sub.id)}>
                View
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  try {
                    await updateAgent.mutateAsync({
                      id: sub.id,
                      data: { parentAgentId: null, agentType: "standalone" },
                    });
                    toast.success("Sub-agent unlinked");
                  } catch {
                    toast.error("Failed to unlink sub-agent");
                  }
                }}
              >
                <X className="h-4 w-4 mr-1" />
                Remove
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
