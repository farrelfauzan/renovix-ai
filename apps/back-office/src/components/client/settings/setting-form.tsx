"use client";

import { useState, type FormEvent } from "react";
import type { PlatformSetting } from "@/lib/settings/platform-setting";
import type { SettingDescription } from "@/lib/settings/setting-description";
import { LabeledInput } from "../form/labeled-input";

type SettingFormProps = {
  readonly setting: PlatformSetting;
  readonly description: SettingDescription;
  /** Saves the value; answers the API's refusal text, or null when it was saved. */
  readonly onSave: (value: number, reason: string) => Promise<string | null>;
  readonly onClose: () => void;
};

/** Edits one setting: the number input enforces its unit and lowest value, the API's schema is the authority. */
export function SettingForm({ setting, description, onSave, onClose }: SettingFormProps) {
  const [value, setValue] = useState(setting.value === null ? "" : String(setting.value));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = await onSave(Number(value), reason.trim());
    if (message === null) return onClose();
    setError(message);
  };
  return (
    <form aria-label={`Edit ${description.label}`} onSubmit={submit} className="flex max-w-md flex-col gap-3 rounded-rx border border-rx-line p-4">
      <LabeledInput label={description.label} name="value" type="number" min={description.min} step={description.unit === "count" ? "1" : "any"} isRequired value={value} onChange={setValue} />
      <LabeledInput label="Reason (required, audited)" name="reason" isRequired maxLength={500} value={reason} onChange={setReason} />
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded-rx bg-rx-accent px-3 py-1 text-sm text-rx-on-accent">Save setting</button>
        <button type="button" onClick={onClose} className="rounded-rx border border-rx-line px-3 py-1 text-sm">Cancel</button>
      </div>
    </form>
  );
}
