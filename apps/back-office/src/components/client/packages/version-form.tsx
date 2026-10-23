"use client";

import { useState, type FormEvent } from "react";
import { buildVersionInput } from "@/lib/packages/build-version-input";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import { findCurrentVersion } from "@/lib/packages/current-version";
import { describePrice, describeTerms } from "@/lib/packages/describe-terms";
import type { OfferKind } from "@/lib/packages/offer-kind";
import { toVersionFields } from "@/lib/packages/to-version-fields";
import type { VersionFields } from "@/lib/packages/version-fields";
import type { VersionInput } from "@/lib/packages/version-input";
import { LabeledInput } from "../form/labeled-input";

const TIERS = ["standard", "advanced", "premium", "frontier"];
const INPUT = "rounded-rx border border-rx-line px-2 py-1";

type VersionFormProps = {
  readonly kind: OfferKind;
  readonly offer: CatalogOffer;
  /** Saves the version (asks for re-authentication first); answers the refusal text, or null when it was saved. */
  readonly onSave: (input: VersionInput) => Promise<string | null>;
  readonly onClose: () => void;
};

/** A new version of an offer: price, credits, limits and tiers, when it takes effect and why. Earlier versions are never edited. */
export function VersionForm({ kind, offer, onSave, onClose }: VersionFormProps) {
  const current = findCurrentVersion(offer);
  const next = (offer.versions[0]?.versionNumber ?? 0) + 1;
  const [fields, setFields] = useState<VersionFields>(() => toVersionFields(kind, current));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof VersionFields>(key: K, value: VersionFields[K]) => setFields((held) => ({ ...held, [key]: value }));
  const toggleTier = (tier: string) => set("allowedTiers", fields.allowedTiers.includes(tier) ? fields.allowedTiers.filter((entry) => entry !== tier) : [...fields.allowedTiers, tier]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const built = buildVersionInput(kind, fields);
    if ("error" in built) return setError(built.error);
    const message = await onSave(built.input);
    if (message === null) return onClose();
    setError(message);
  };
  return (
    <form role="dialog" aria-label={`New version of ${offer.name}`} onSubmit={submit} className="mt-4 flex max-w-xl flex-col gap-3 rounded-rx border border-rx-line p-4">
      <p className="text-sm">
        This creates version {next} of {offer.name}. Earlier versions stay as history and earlier buyers keep the snapshot of the version they bought (D37).
        {current && <span className="text-rx-muted"> Before: {describePrice(kind, current)} · {describeTerms(kind, current)} (v{current.versionNumber}).</span>}
      </p>
      <LabeledInput label={kind === "enterprise-bundle" ? "Monthly price (USD, blank: not set)" : "Price (USD)"} name="price" type="number" min={0} step="0.01" value={fields.price} onChange={(value) => set("price", value)} />
      <LabeledInput label={kind === "enterprise-bundle" ? "Pool credits per period (blank: not set)" : "Credits granted"} name="credits" type="number" min={0} step="any" value={fields.credits} onChange={(value) => set("credits", value)} />
      {kind === "package" && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Billing
            <select name="billing" value={fields.billing} onChange={(event) => set("billing", event.target.value as VersionFields["billing"])} className={INPUT}>
              <option value="monthly">Monthly</option>
              <option value="one_time">One time</option>
            </select>
          </label>
          <LabeledInput label="Agents" name="maxAgents" type="number" min={0} value={fields.maxAgents} onChange={(value) => set("maxAgents", value)} />
          <LabeledInput label="Connected tools" name="maxConnectedTools" type="number" min={0} value={fields.maxConnectedTools} onChange={(value) => set("maxConnectedTools", value)} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fields.apiAccess} onChange={(event) => set("apiAccess", event.target.checked)} /> API access</label>
          <LabeledInput label="Allowed channels (comma separated)" name="allowedChannels" value={fields.allowedChannels} onChange={(value) => set("allowedChannels", value)} />
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="mb-1">Allowed tiers</legend>
            {TIERS.map((tier) => (
              <label key={tier} className="flex items-center gap-2"><input type="checkbox" checked={fields.allowedTiers.includes(tier)} onChange={() => toggleTier(tier)} /> {tier}</label>
            ))}
          </fieldset>
        </>
      )}
      <LabeledInput label="Effective from" name="effectiveFrom" type="datetime-local" isRequired value={fields.effectiveFrom} onChange={(value) => set("effectiveFrom", value)} />
      <LabeledInput label="Reason (required, audited)" name="reason" isRequired maxLength={500} value={fields.reason} onChange={(value) => set("reason", value)} />
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded-rx bg-rx-accent px-3 py-1 text-sm text-rx-on-accent">Save as v{next}</button>
        <button type="button" onClick={onClose} className="rounded-rx border border-rx-line px-3 py-1 text-sm">Cancel</button>
      </div>
    </form>
  );
}
