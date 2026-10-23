"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useAgent,
  useDeleteAgent,
  usePublishAgent,
  useUpdateAgentStatus,
} from "@/hooks/use-agents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Save,
  Rocket,
  Loader2,
  Wrench,
  Database,
  Home,
  Trash2,
  Power,
  PowerOff,
} from "lucide-react";
import { toast } from "sonner";
import { AgentSettingsTab } from "@/components/agents/agent-detail/agent-settings-tab";
import { AgentToolsTab } from "@/components/agents/agent-detail/agent-tools-tab";
import { AgentKnowledgeTab } from "@/components/agents/agent-detail/agent-knowledge-tab";

export default function AgentDetailPageClient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: agent, isLoading } = useAgent(id);
  const publishAgent = usePublishAgent();
  const updateStatus = useUpdateAgentStatus();
  const deleteAgent = useDeleteAgent();

  const tabs = [
    { id: "settings", label: "Settings", icon: Save },
    { id: "tools", label: "Tools", icon: Wrench },
    { id: "knowledge", label: "Knowledge", icon: Database },
    // { id: "deployments", label: "Deployments", icon: Radio },
  ] as const;

  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("settings");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Agent not found</p>
        <Button variant="outline" onClick={() => router.push("/agents")} className="mt-4">
          Back to Agents
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push("/agents")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-lg">
                {agent.avatar || "🤖"}
              </div>
              <div>
                <h1 className="text-xl font-bold">{agent.name}</h1>
                <Badge
                  variant="outline"
                  className={
                    agent.status === "active"
                      ? "text-green-500 capitalize"
                      : agent.status === "draft"
                        ? "text-yellow-500 capitalize"
                        : "text-gray-500 capitalize"
                  }
                >
                  {agent.status}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/agents" className="mr-2">
              <Button variant="ghost" size="sm">
                <Home className="h-4 w-4 mr-2" />
                Back to Chat
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const newStatus = agent.status === "active" ? "draft" : "active";
                try {
                  await updateStatus.mutateAsync({ id, status: newStatus });
                  toast.success(
                    `Agent ${newStatus === "active" ? "activated" : "deactivated"}`,
                  );
                } catch {
                  toast.error("Failed to update status");
                }
              }}
            >
              {agent.status === "active" ? (
                <>
                  <PowerOff className="h-4 w-4 mr-2" />
                  Deactivate
                </>
              ) : (
                <>
                  <Power className="h-4 w-4 mr-2" />
                  Activate
                </>
              )}
            </Button>
            {/* <Button variant="outline" onClick={() => router.push(`/agents/${id}/chat`)}>
              <MessageSquare className="h-4 w-4 mr-2" />
              Chat
            </Button> */}
            {agent.status === "draft" && (
              <Button
                onClick={async () => {
                  try {
                    await publishAgent.mutateAsync(id);
                    toast.success("Agent published!");
                  } catch {
                    toast.error("Failed to publish");
                  }
                }}
              >
                <Rocket className="h-4 w-4 mr-2" />
                Publish
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="icon"
                  disabled={agent.status === "active"}
                  title={agent.status === "active" ? "Deactivate agent first" : "Delete agent"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Agent</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete &quot;{agent.name}&quot;? This action cannot be undone.
                    All runs, messages, and configurations will be permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        await deleteAgent.mutateAsync(id);
                        toast.success("Agent deleted");
                        router.push("/agents");
                      } catch {
                        toast.error("Failed to delete agent");
                      }
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="flex gap-1 border-b mb-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "settings" && <AgentSettingsTab agent={agent} agentId={id} />}
        {activeTab === "tools" && <AgentToolsTab agent={agent} agentId={id} />}
        {/* {activeTab === "integrations" && <IntegrationsTab agent={agent} agentId={id} />} */}
        {activeTab === "knowledge" && <AgentKnowledgeTab agent={agent} agentId={id} />}
        {/* {activeTab === "deployments" && <AgentDeploymentsTab agent={agent} />} */}
      </div>
    </div>
  );
}
