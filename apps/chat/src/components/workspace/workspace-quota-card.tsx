"use client";

import type { WorkspaceQuota } from "@/lib/workspace-types";

interface Props {
  quota: WorkspaceQuota;
}

export function WorkspaceQuotaCard({ quota }: Props) {
  const percentage = quota.limit > 0 ? (quota.used / quota.limit) * 100 : 0;
  const remaining = quota.limit - quota.used;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Team Seats</h3>
        <span className="text-xs text-muted-foreground capitalize">
          {quota.tier} plan
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {quota.used} / {quota.limit} seats used
          </span>
          <span className="text-muted-foreground">
            {remaining} available
          </span>
        </div>
        <div className="h-2 rounded-full bg-rx-surface-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
