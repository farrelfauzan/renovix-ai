"use client";

import { useState, type FormEvent } from "react";
import type { CodeInput } from "@/lib/codes/code-input";
import { LabeledInput } from "../form/labeled-input";

type CodeFormProps = {
  /** Creates the code (asks for re-authentication first); answers the refusal text, or null when it was created. */
  readonly onSave: (input: CodeInput) => Promise<string | null>;
  readonly onClose: () => void;
};

/** Creates an invitation code that grants credits, a plan or both. The text is generated when left blank. */
export function CodeForm({ onSave, onClose }: CodeFormProps) {
  const [type, setType] = useState<CodeInput["type"]>("topup");
  const [code, setCode] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [packageVersionId, setPackageVersionId] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const grantsCredits = type !== "subscription";
  const grantsPlan = type !== "topup";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input: CodeInput = {
      type,
      maxRedemptions: Number(maxRedemptions),
      ...(code.trim() && { code: code.trim() }),
      ...(grantsCredits && { creditAmount: Number(creditAmount) }),
      ...(grantsPlan && { packageVersionId: packageVersionId.trim() }),
    };
    const message = await onSave(input);
    if (message === null) return onClose();
    setError(message);
  };
  return (
    <form role="dialog" aria-label="Create an invitation code" onSubmit={submit} className="mt-4 flex max-w-md flex-col gap-3 rounded-rx border border-rx-line p-4">
      <label className="flex flex-col gap-1 text-sm">
        Grants
        <select name="type" value={type} onChange={(event) => setType(event.target.value as CodeInput["type"])} className="rounded-rx border border-rx-line px-2 py-1">
          <option value="topup">Credits</option>
          <option value="subscription">A plan</option>
          <option value="both">Credits and a plan</option>
        </select>
      </label>
      <LabeledInput label="Code text (blank: generated)" name="code" maxLength={50} value={code} onChange={setCode} />
      {grantsCredits && <LabeledInput label="Credits" name="creditAmount" type="number" min={0} step="any" isRequired value={creditAmount} onChange={setCreditAmount} />}
      {grantsPlan && <LabeledInput label="Package version id" name="packageVersionId" isRequired value={packageVersionId} onChange={setPackageVersionId} />}
      <LabeledInput label="Maximum redemptions" name="maxRedemptions" type="number" min={1} step="1" isRequired value={maxRedemptions} onChange={setMaxRedemptions} />
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded-rx bg-rx-accent px-3 py-1 text-sm text-rx-on-accent">Create code</button>
        <button type="button" onClick={onClose} className="rounded-rx border border-rx-line px-3 py-1 text-sm">Cancel</button>
      </div>
    </form>
  );
}
