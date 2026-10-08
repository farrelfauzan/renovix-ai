"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useAttachTool,
  useAvailableTools,
  useRemoveTool,
} from "@/hooks/use-agents";
import {
  useDeleteBraveWebSearchKey,
  useUpdateWebSearchPolicy,
  useUpsertBraveWebSearchKey,
  useWebSearchPolicy,
  useWebSearchStatus,
} from "@/hooks/use-web-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AgentToolsTabProps = {
  agent: any;
  agentId: string;
};

export function AgentToolsTab({ agent, agentId }: AgentToolsTabProps) {
  const attachTool = useAttachTool();
  const removeTool = useRemoveTool();
  const { data: availableTools } = useAvailableTools();
  const workspaceId = agent?.workspaceId || null;

  const { data: webSearchStatus } = useWebSearchStatus(workspaceId);
  const { data: webSearchPolicy } = useWebSearchPolicy(workspaceId);
  const upsertBraveKey = useUpsertBraveWebSearchKey();
  const deleteBraveKey = useDeleteBraveWebSearchKey();
  const updatePolicy = useUpdateWebSearchPolicy();

  const [braveApiKey, setBraveApiKey] = useState("");
  const [allowedProviders, setAllowedProviders] = useState<string[]>([]);
  const [preferredProvider, setPreferredProvider] = useState<string>(
    "brave-search",
  );
  const [maxResults, setMaxResults] = useState(5);
  const [dailyLimitPerUser, setDailyLimitPerUser] = useState(100);

  useEffect(() => {
    if (!webSearchPolicy) return;
    setAllowedProviders(webSearchPolicy.allowedProviders);
    setPreferredProvider(webSearchPolicy.preferredProvider);
    setMaxResults(webSearchPolicy.maxResults);
    setDailyLimitPerUser(webSearchPolicy.dailyLimitPerUser);
  }, [webSearchPolicy]);

  const handleToggleTool = async (toolType: string, isActive: boolean) => {
    try {
      if (isActive) {
        const tool = agent?.tools.find((t: any) => t.toolType === toolType);
        if (tool) {
          await removeTool.mutateAsync({ agentId, toolId: tool.id });
        }
      } else {
        await attachTool.mutateAsync({
          agentId,
          data: { toolType, enabled: true },
        });
      }
    } catch {
      toast.error("Failed to update tool");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-4">
        Enable or disable tools for this agent.
      </p>
      <p className="text-xs text-muted-foreground -mt-2 mb-4">
        Tools marked "Needs setup" require external credentials before they can run.
      </p>
      {(availableTools || []).map((tool: any) => {
        const isActive = agent.tools.some((t: any) => t.toolType === tool.type);
        return (
          <div
            key={tool.type}
            className="flex items-center justify-between p-4 rounded-lg border"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm">{tool.name}</p>
                {tool.configRequired && (
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    Needs setup
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{tool.description}</p>
              {tool.type === "web_search" && tool.configRequired && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Requires a connected Brave API key. You can configure it below.
                  </p>

                  {!workspaceId && (
                    <p className="text-xs text-amber-400">
                      Web search setup needs a workspace-linked agent.
                    </p>
                  )}

                  {workspaceId && (
                    <div className="space-y-3 rounded-md border p-3 bg-muted/20">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs">
                          Brave key status: {webSearchStatus?.connected ? "Connected" : "Not connected"}
                          {webSearchStatus?.maskedKey
                            ? ` (${webSearchStatus.maskedKey})`
                            : ""}
                        </p>
                        {webSearchStatus?.connected && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              try {
                                await deleteBraveKey.mutateAsync({ workspaceId });
                                toast.success("Brave key disconnected");
                              } catch {
                                toast.error("Failed to disconnect Brave key");
                              }
                            }}
                            disabled={deleteBraveKey.isPending}
                          >
                            Disconnect
                          </Button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Input
                          type="password"
                          placeholder="Paste Brave API key"
                          value={braveApiKey}
                          onChange={(e) => setBraveApiKey(e.target.value)}
                        />
                        <Button
                          size="sm"
                          onClick={async () => {
                            if (!braveApiKey.trim()) {
                              toast.error("Please enter Brave API key");
                              return;
                            }
                            try {
                              await upsertBraveKey.mutateAsync({
                                workspaceId,
                                apiKey: braveApiKey.trim(),
                              });
                              setBraveApiKey("");
                              toast.success("Brave key connected");
                            } catch {
                              toast.error("Failed to connect Brave key");
                            }
                          }}
                          disabled={upsertBraveKey.isPending}
                        >
                          Connect
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="text-xs text-muted-foreground">
                          Preferred provider
                          <select
                            className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs"
                            value={preferredProvider}
                            onChange={(e) => setPreferredProvider(e.target.value)}
                          >
                            <option value="brave-search">Brave Search</option>
                            <option value="duckduckgo">DuckDuckGo</option>
                          </select>
                        </label>

                        <label className="text-xs text-muted-foreground">
                          Allowed providers
                          <select
                            className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs"
                            value={allowedProviders.join(",") || "brave-search"}
                            onChange={(e) =>
                              setAllowedProviders(
                                e.target.value
                                  .split(",")
                                  .map((v) => v.trim())
                                  .filter(Boolean),
                              )
                            }
                          >
                            <option value="brave-search">Brave only</option>
                            <option value="duckduckgo">DuckDuckGo only</option>
                            <option value="brave-search,duckduckgo">
                              Brave + DuckDuckGo fallback
                            </option>
                          </select>
                        </label>

                        <label className="text-xs text-muted-foreground">
                          Max results
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={maxResults}
                            onChange={(e) => setMaxResults(Number(e.target.value) || 5)}
                            className="mt-1 h-8"
                          />
                        </label>

                        <label className="text-xs text-muted-foreground">
                          Daily limit per user
                          <Input
                            type="number"
                            min={1}
                            max={1000}
                            value={dailyLimitPerUser}
                            onChange={(e) =>
                              setDailyLimitPerUser(Number(e.target.value) || 100)
                            }
                            className="mt-1 h-8"
                          />
                        </label>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Policy updates require workspace owner/admin permission.
                      </p>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await updatePolicy.mutateAsync({
                              workspaceId,
                              data: {
                                allowedProviders: allowedProviders as Array<
                                  "brave-search" | "duckduckgo"
                                >,
                                preferredProvider: preferredProvider as
                                  | "brave-search"
                                  | "duckduckgo",
                                maxResults,
                                dailyLimitPerUser,
                              },
                            });
                            toast.success("Web search policy updated");
                          } catch {
                            toast.error("Failed to update policy");
                          }
                        }}
                        disabled={updatePolicy.isPending}
                      >
                        Save policy
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <Button
              variant={isActive ? "destructive" : "default"}
              size="sm"
              onClick={() => handleToggleTool(tool.type, isActive)}
            >
              {isActive ? "Remove" : "Add"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
