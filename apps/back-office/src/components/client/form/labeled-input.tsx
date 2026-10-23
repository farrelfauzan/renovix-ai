"use client";

type LabeledInputProps = {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: "text" | "number" | "datetime-local";
  readonly step?: string;
  readonly min?: number;
  readonly maxLength?: number;
  readonly isRequired?: boolean;
};

/** A labelled text, number or date input in the back-office form style. */
export function LabeledInput({ label, name, value, onChange, type = "text", step, min, maxLength, isRequired = false }: LabeledInputProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input name={name} type={type} step={step} min={min} maxLength={maxLength} required={isRequired} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-rx border border-rx-line px-2 py-1" />
    </label>
  );
}
