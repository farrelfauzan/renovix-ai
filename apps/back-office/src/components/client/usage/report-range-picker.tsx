"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@performa-ai/ui/components/select";
import { DEFAULT_RANGE_DAYS } from "@/lib/usage/default-range-days";
import { lastDaysRange } from "@/lib/usage/last-days-range";
import { RANGE_PRESET_DAYS } from "@/lib/usage/range-preset-days";
import type { ReportRange } from "@/lib/usage/report-range";
import { ReportRangeForm } from "./report-range-form";

const CUSTOM = "custom";

type ReportRangePickerProps = {
  /** The range the views show now; the custom form starts from it. */
  readonly range: ReportRange;
  /** True when the screen opened on a given range rather than the default preset. */
  readonly isInitiallyCustom: boolean;
  readonly onApply: (range: ReportRange) => void;
};

/**
 * The range of the three views (RNX-315): the last 7, 30 or 90 days ending today in Asia/Jakarta (the API's report
 * days), applied when picked, or a custom range typed in the From and To form.
 */
export function ReportRangePicker({ range, isInitiallyCustom, onApply }: ReportRangePickerProps) {
  const [preset, setPreset] = useState(isInitiallyCustom ? CUSTOM : String(DEFAULT_RANGE_DAYS));
  const pick = (value: string) => {
    setPreset(value);
    if (value !== CUSTOM) onApply(lastDaysRange(Number(value)));
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select value={preset} onValueChange={pick}>
        <SelectTrigger aria-label="Range" className="rounded-rx border-rx-line px-2.5 text-[13px] data-[size=default]:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESET_DAYS.map((days) => (
            <SelectItem key={days} value={String(days)}>Last {days} days</SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Custom range</SelectItem>
        </SelectContent>
      </Select>
      {preset === CUSTOM && <ReportRangeForm initial={range} onApply={onApply} />}
    </div>
  );
}
