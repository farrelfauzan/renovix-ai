"use client";

import { usePublicAgents, useCloneTemplate } from "@/hooks/use-agents";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Globe, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { isPackageLimitError } from "@/lib/is-package-limit-error";

export default function ExploreAgentsPageClient() {
  const router = useRouter();
  const { data: agents, isLoading } = usePublicAgents();
  const cloneTemplate = useCloneTemplate();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Explore Agents</h1>
            <p className="text-muted-foreground mt-1">
              Browse public agent templates created by the community
            </p>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty */}
        {!isLoading && (!agents || agents.length === 0) && (
          <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed rounded-lg">
            <Globe className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No public agents yet</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              Be the first to publish a public agent template!
            </p>
          </div>
        )}

        {/* Grid */}
        {agents && agents.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent: any) => (
              <div
                key={agent.id}
                className="border rounded-lg p-5 hover:border-primary/50 transition-colors bg-card"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-lg">
                    {agent.avatar || "🤖"}
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{agent.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      by {agent.user?.email}
                    </p>
                  </div>
                </div>
                {agent.description && (
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                    {agent.description}
                  </p>
                )}
                <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground mb-4">
                  <Badge variant="secondary" className="text-xs capitalize">
                    {agent.agentType}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {agent.model?.split("/").pop() || agent.model}
                  </Badge>
                  <span>{agent._count?.runs || 0} runs</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={cloneTemplate.isPending}
                  onClick={() => {
                    cloneTemplate.mutate(agent.id, {
                      onSuccess: (newAgent) => {
                        toast.success(`"${agent.name}" added to your agents!`);
                        router.push(`/agents/${newAgent.id}`);
                      },
                      onError: (err) => {
                        if (isPackageLimitError(err)) return;
                        toast.error("Failed to add template. Make sure you have an active subscription.");
                      },
                    });
                  }}
                >
                  <Bot className="h-3.5 w-3.5 mr-2" />
                  {cloneTemplate.isPending ? "Adding..." : "Use Template"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
