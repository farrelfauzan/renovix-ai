"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@performa-ai/ui/components/select";
import type { CodeInput } from "@/lib/codes/code-input";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import { formatUsdCents } from "@/lib/packages/format-usd-cents";
import { LabeledInput } from "../form/labeled-input";

type CodeFormProps = {
  /** The packages with their versions (the picker lists every version, scheduled ones marked); null until they have loaded. */
  readonly packages: readonly CatalogOffer[] | null;
  /** Creates the code (asks for re-authentication first); answers the refusal text, or null when it was created. */
  readonly onSave: (input: CodeInput) => Promise<string | null>;
  readonly onClose: () => void;
};

/** Creates an invitation code that grants credits, a plan or both. The text is generated when left blank. */
export function CodeForm({ packages, onSave, onClose }: CodeFormProps) {
  const [type, setType] = useState<CodeInput["type"]>("topup");
  const [code, setCode] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [packageVersionId, setPackageVersionId] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const grantsCredits = type !== "subscription";
  const grantsPlan = type !== "topup";
  const now = new Date();
  const versionOptions = (packages ?? []).flatMap((offer) => offer.versions.map((version) => ({
    id: version.id,
    label: `${offer.name} v${version.versionNumber}${new Date(version.effectiveFrom) > now ? " (scheduled)" : ""} · ${formatUsdCents(version.priceUsdCents)} · from ${new Date(version.effectiveFrom).toLocaleDateString("en-GB")}`,
  })));
  const isMissingVersions = grantsPlan && packages !== null && versionOptions.length === 0;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input: CodeInput = {
      type,
      maxRedemptions: Number(maxRedemptions),
      ...(code.trim() && { code: code.trim() }),
      ...(grantsCredits && { creditAmount: Number(creditAmount) }),
      ...(grantsPlan && { packageVersionId }),
    };
    const message = await onSave(input);
    if (message === null) return onClose();
    setError(message);
  };
  return (
    <form role="dialog" aria-label="Create an invitation code" onSubmit={submit} className="mt-4 flex max-w-md flex-col gap-3 rounded-rx border border-rx-line p-4">
      <label className="flex flex-col gap-1 text-sm">
        Grants
        <Select name="type" value={type} onValueChange={(value) => setType(value as CodeInput["type"])}>
          <SelectTrigger className="w-full rounded-rx border-rx-line px-2 py-1 data-[size=default]:h-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="topup">Credits</SelectItem>
            <SelectItem value="subscription">A plan</SelectItem>
            <SelectItem value="both">Credits and a plan</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <LabeledInput label="Code text (blank: generated)" name="code" maxLength={50} value={code} onChange={setCode} />
      {grantsCredits && <LabeledInput label="Credits" name="creditAmount" type="number" min={0} step="any" isRequired value={creditAmount} onChange={setCreditAmount} />}
      {grantsPlan && versionOptions.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          Package version
          <Select name="packageVersionId" required value={packageVersionId} onValueChange={setPackageVersionId}>
            <SelectTrigger className="w-full rounded-rx border-rx-line px-2 py-1 data-[size=default]:h-auto">
              <SelectValue placeholder="Choose a package version" />
            </SelectTrigger>
            <SelectContent>
              {versionOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
      )}
      {isMissingVersions && <p className="text-sm text-rx-muted">No package versions yet</p>}
      <LabeledInput label="Maximum redemptions" name="maxRedemptions" type="number" min={1} step="1" isRequired value={maxRedemptions} onChange={setMaxRedemptions} />
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={grantsPlan && !packageVersionId} className="rounded-rx bg-rx-accent px-3 py-1 text-sm text-rx-on-accent h-auto font-normal whitespace-normal">Create code</Button>
        <Button variant="outline" type="button" onClick={onClose} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Cancel</Button>
      </div>
    </form>
  );
}
