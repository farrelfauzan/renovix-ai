"use client";

import { Badge } from "@/components/ui/badge";
import { useMyEntitlements } from "@/hooks/use-my-entitlements";

type PackageLimitPillProps =
  | { kind: "agents" }
  | { kind: "connectedTools"; connectedToolCount: number }
  | { kind: "apiAccess" };

/** A small pill with the user's usage of one package limit; renders nothing while loading or on error. */
export function PackageLimitPill(props: PackageLimitPillProps) {
  const { data } = useMyEntitlements();
  if (!data) return null;
  const upgradeLabel = data.apiAccessNextPackage ? `Available on ${data.apiAccessNextPackage}` : "Not in your package";
  const label =
    props.kind === "agents"
      ? `${data.agents.used} of ${data.agents.limit} agents`
      : props.kind === "connectedTools"
        ? `${props.connectedToolCount} of ${data.connectedToolsPerAgent} connected tools`
        : data.apiAccess
          ? "API access included"
          : upgradeLabel;
  return (
    <Badge variant="outline" className="text-[10px]">
      {label}
    </Badge>
  );
}
