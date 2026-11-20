"use client";

import { Input } from "@performa-ai/ui/components/input";

interface SettingsTextFieldProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  maxLength: number;
  type?: "text" | "tel" | "email" | "password";
  onChange: (value: string) => void;
}

/** RNX-77a: one labelled text field of Settings > General, with the line that says what it is used for. */
export function SettingsTextField({ id, label, hint, value, maxLength, type = "text", onChange }: SettingsTextFieldProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        className="h-(--rx-button-height)"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}
