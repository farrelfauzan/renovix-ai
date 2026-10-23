"use client";

import { useState, type FormEvent } from "react";
import { describeRangeProblem } from "@/lib/usage/describe-range-problem";
import type { ReportRange } from "@/lib/usage/report-range";
import { SectionMessage } from "./section-message";

/** The days the three views cover; `onApply` gets the range once it is one the API accepts (at most 92 days). */
export function ReportRangeForm({ initial, onApply }: { initial: ReportRange; onApply: (range: ReportRange) => void }) {
  const [range, setRange] = useState<ReportRange>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = describeRangeProblem(range);
    setProblem(found);
    if (!found) onApply(range);
  };
  return (
    <form aria-label="Report range" onSubmit={submit} className="flex flex-wrap items-end gap-3">
      {(["from", "to"] as const).map((name) => (
        <label key={name} className="flex flex-col gap-1 text-sm text-rx-muted">
          {name === "from" ? "From" : "To"}
          <input
            type="date"
            value={range[name]}
            onChange={(event) => setRange({ ...range, [name]: event.target.value })}
            className="rounded-rx border border-rx-line px-2 py-1 text-rx-text"
          />
        </label>
      ))}
      <button type="submit" className="rounded-rx border border-rx-line px-3 py-1 text-sm">
        Apply range
      </button>
      {problem && <SectionMessage text={problem} isError />}
    </form>
  );
}
