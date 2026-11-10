"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  useAttachKnowledgeBase,
  useRemoveKnowledgeBase,
} from "@/hooks/use-agents";
import { useKnowledgeBases } from "@/hooks/use-knowledge";
import { Button } from "@performa-ai/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@performa-ai/ui/components/select";
import { Plus, X } from "lucide-react";

type AgentKnowledgeTabProps = {
  agent: any;
  agentId: string;
};

export function AgentKnowledgeTab({ agent, agentId }: AgentKnowledgeTabProps) {
  const { data: knowledgeBases } = useKnowledgeBases();
  const attachKB = useAttachKnowledgeBase();
  const removeKB = useRemoveKnowledgeBase();
  const [selectedKB, setSelectedKB] = useState<string>("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground mb-4">
        Attach knowledge bases for RAG-powered responses.
      </p>

      <div className="flex gap-2">
        <Select value={selectedKB} onValueChange={setSelectedKB}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select a knowledge base to attach" />
          </SelectTrigger>
          <SelectContent>
            {(knowledgeBases || [])
              .filter(
                (kb: any) =>
                  !agent.knowledgeBases.some(
                    (akb: any) => akb.knowledgeBaseId === kb.id,
                  ),
              )
              .map((kb: any) => (
                <SelectItem key={kb.id} value={kb.id}>
                  {kb.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button
          onClick={async () => {
            if (!selectedKB) return;
            try {
              await attachKB.mutateAsync({
                agentId,
                knowledgeBaseId: selectedKB,
              });
              setSelectedKB("");
              toast.success("Knowledge base attached");
            } catch {
              toast.error("Failed to attach knowledge base");
            }
          }}
          disabled={!selectedKB || attachKB.isPending}
        >
          <Plus className="h-4 w-4 mr-2" />
          Attach
        </Button>
      </div>

      {agent.knowledgeBases.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          No knowledge bases attached.
        </p>
      ) : (
        agent.knowledgeBases.map((akb: any) => (
          <div
            key={akb.id}
            className="flex items-center justify-between p-4 rounded-lg border"
          >
            <div>
              <p className="font-medium text-sm">
                {akb.knowledgeBase?.name || akb.knowledgeBaseId}
              </p>
              <p className="text-xs text-muted-foreground">
                {akb.knowledgeBase?.description || "No description"}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                try {
                  await removeKB.mutateAsync({
                    agentId,
                    kbId: akb.id,
                  });
                  toast.success("Knowledge base removed");
                } catch {
                  toast.error("Failed to remove knowledge base");
                }
              }}
            >
              <X className="h-4 w-4 mr-1" />
              Remove
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
