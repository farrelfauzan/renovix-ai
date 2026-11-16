"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@performa-ai/ui/components/select";

interface ProfileStepSelectProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  /** RNX-77a: a `disabled` option is shown but cannot be chosen (a locked model tier). */
  options: readonly { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}

/** One labelled choice of the profile step, with the line that says what it is used for. */
export function ProfileStepSelect({ id, label, hint, value, placeholder, options, onChange }: ProfileStepSelectProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full data-[size=default]:h-(--rx-button-height)">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}
