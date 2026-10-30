"use client";

import { SelectItem } from "@/components/ui/select";
import type { MyEntitlements } from "@/hooks/use-my-entitlements";
import type { PortalModel } from "@/hooks/use-portal";
import { getModelLockLabel } from "@/lib/get-model-lock-label";
import { isModelLocked } from "@/lib/model-lock";

type ModelSelectItemProps = {
  model: PortalModel;
  entitlements: MyEntitlements | undefined;
  className?: string;
};

/** A model option that is disabled, with the upgrade hint, when the user's package lacks its tier. */
export function ModelSelectItem({ model, entitlements, className }: ModelSelectItemProps) {
  const lockLabel = entitlements && isModelLocked(model, entitlements) ? getModelLockLabel(entitlements) : null;
  return (
    <SelectItem value={model.slug} disabled={lockLabel !== null} className={className}>
      {model.name}
      {lockLabel ? <span className="ml-2 text-[10px] text-muted-foreground">{lockLabel}</span> : null}
    </SelectItem>
  );
}
