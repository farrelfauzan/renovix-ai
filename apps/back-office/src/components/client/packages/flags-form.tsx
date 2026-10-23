"use client";

import { useState, type FormEvent } from "react";
import type { CatalogOffer } from "@/lib/packages/catalog-offer";
import type { FlagsInput } from "@/lib/packages/flags-input";
import type { OfferKind } from "@/lib/packages/offer-kind";
import { LabeledInput } from "../form/labeled-input";

type FlagsFormProps = {
  readonly kind: OfferKind;
  readonly offer: CatalogOffer;
  /** Saves the change; answers the API's refusal text, or null when it was saved. */
  readonly onSave: (input: FlagsInput) => Promise<string | null>;
  readonly onClose: () => void;
};

/** Changes an offer's active flag (a package's visible flag and display order too). A reason is required; no new version. */
export function FlagsForm({ kind, offer, onSave, onClose }: FlagsFormProps) {
  const [active, setActive] = useState(offer.active);
  const [visible, setVisible] = useState(offer.visible ?? true);
  const [displayOrder, setDisplayOrder] = useState(String(offer.displayOrder ?? 0));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const base = { active, reason: reason.trim() };
    const message = await onSave(kind === "package" ? { ...base, visible, displayOrder: Number(displayOrder) } : base);
    if (message === null) return onClose();
    setError(message);
  };
  return (
    <form role="dialog" aria-label={`Flags of ${offer.name}`} onSubmit={submit} className="mt-4 flex max-w-md flex-col gap-3 rounded-rx border border-rx-line p-4">
      <p className="text-sm">Flags of {offer.name}. This does not create a new version.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active</label>
      {kind === "package" && (
        <>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} /> Visible on public pricing</label>
          <LabeledInput label="Display order" name="displayOrder" type="number" min={0} step="1" isRequired value={displayOrder} onChange={setDisplayOrder} />
        </>
      )}
      <LabeledInput label="Reason (required, audited)" name="reason" isRequired maxLength={500} value={reason} onChange={setReason} />
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded-rx bg-rx-accent px-3 py-1 text-sm text-rx-on-accent">Save flags</button>
        <button type="button" onClick={onClose} className="rounded-rx border border-rx-line px-3 py-1 text-sm">Cancel</button>
      </div>
    </form>
  );
}
