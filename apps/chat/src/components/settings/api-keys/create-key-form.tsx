"use client";

import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Checkbox } from "@performa-ai/ui/components/checkbox";
import { Input } from "@performa-ai/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@performa-ai/ui/components/select";
import { PackageLimitPill } from "@/components/package-limit-pill";
import { useCreateApiKey } from "@/hooks/use-api-keys";
import type { CreateApiKeyInput, CreatedApiKey } from "@/lib/api-key-types";
import { getPackageLimitMessage } from "@/lib/package-limit-message";

interface CreateKeyFormProps {
  offeredTiers: string[];
  hasApiAccess: boolean;
  nextPackage: string | null;
  onCreatedAction: (created: CreatedApiKey) => void;
}

const EXPIRY_OPTIONS = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "1y", label: "1 year" },
  { value: "never", label: "Never" },
] as const;

/** Creates a key: name, the model tiers the package allows, an optional monthly credit cap and an expiry. */
export function CreateKeyForm({ offeredTiers, hasApiAccess, nextPackage, onCreatedAction }: CreateKeyFormProps) {
  const { createKey, isCreating } = useCreateApiKey();
  const [name, setName] = useState("");
  const [tiers, setTiers] = useState<string[]>(offeredTiers.slice(0, 1));
  const [cap, setCap] = useState("");
  const [expiresIn, setExpiresIn] = useState<CreateApiKeyInput["expiresIn"]>("1y");
  const toggleTier = (tier: string) =>
    setTiers((current) => (current.includes(tier) ? current.filter((item) => item !== tier) : [...current, tier]));
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const created = await createKey({
      name: name.trim(),
      expiresIn,
      allowedTiers: offeredTiers.filter((tier) => tiers.includes(tier)),
      // An entered cap is always sent, so the API refuses an invalid one (such as 0) instead of the key being created uncapped.
      ...(cap.trim() !== "" ? { monthlyCreditCap: Number(cap) } : {}),
    });
    if (!created) return;
    setName("");
    setCap("");
    onCreatedAction(created);
  };
  const canSubmit = hasApiAccess && !isCreating && name.trim() !== "" && tiers.length > 0;
  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border p-4" aria-label="Create key">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Create key</h2>
        <PackageLimitPill kind="apiAccess" />
      </div>
      {!hasApiAccess && (
        <p className="text-sm text-muted-foreground">
          {getPackageLimitMessage({ error: { type: "PACKAGE_LIMIT_REACHED", feature: "apiAccess", nextPackage } })}
        </p>
      )}
      <div className="space-y-1">
        <label htmlFor="api-key-name" className="text-sm font-medium">Name</label>
        <Input id="api-key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="What will use this key?" maxLength={100} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Allowed model tiers</legend>
        {offeredTiers.map((tier) => (
          <label key={tier} className="flex items-center gap-2 text-sm capitalize">
            <Checkbox checked={tiers.includes(tier)} onCheckedChange={() => toggleTier(tier)} aria-label={tier} />
            {tier}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor="api-key-cap" className="text-sm font-medium">Monthly credit cap (optional)</label>
        <Input id="api-key-cap" type="number" min="0" step="any" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="for example 20" />
      </div>
      <div className="space-y-1">
        <span className="text-sm font-medium">Expires</span>
        <Select value={expiresIn} onValueChange={(value) => setExpiresIn(value as CreateApiKeyInput["expiresIn"])}>
          <SelectTrigger aria-label="Expires">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={!canSubmit}>
        {isCreating ? "Creating..." : "Create key"}
      </Button>
    </form>
  );
}
