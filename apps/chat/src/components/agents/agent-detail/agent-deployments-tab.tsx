"use client";

import { Badge } from "@performa-ai/ui/components/badge";
import { Button } from "@performa-ai/ui/components/button";

type AgentDeploymentsTabProps = {
  agent: any;
};

export function AgentDeploymentsTab({ agent }: AgentDeploymentsTabProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground mb-4">
        Deploy your agent to different platforms.
      </p>
      {agent.channels.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          No deployments configured yet.
        </p>
      ) : (
        agent.channels.map((ch: any) => (
          <div
            key={ch.id}
            className="flex items-center justify-between p-4 rounded-lg border"
          >
            <div>
              <p className="font-medium text-sm capitalize">{ch.channelType}</p>
              <p className="text-xs text-muted-foreground">Status: {ch.status}</p>
            </div>
            <Badge
              variant="outline"
              className={ch.status === "active" ? "text-rx-green" : ""}
            >
              {ch.status}
            </Badge>
          </div>
        ))
      )}
      <div className="grid grid-cols-3 gap-3">
        {["web", "api", "whatsapp"].map((type) => {
          const deployed = agent.channels.some((c: any) => c.channelType === type);
          return (
            <Button
              key={type}
              variant="outline"
              disabled={deployed}
              className="capitalize"
            >
              {deployed ? "✓ " : ""}
              {type}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
