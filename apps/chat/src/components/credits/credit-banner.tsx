"use client";

import Link from "next/link";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@performa-ai/ui/lib/utils";
import { useCreditMeter } from "@/hooks/use-credit-meter";
import { formatCredits } from "@/lib/format-credits";
import { formatRunTime } from "@/lib/format-run-time";
import { pickCreditBanner } from "@/lib/pick-credit-banner";

/**
 * The credit warning above every shell screen (RNX-330): red or amber by the meter's level, or the floor warning.
 * It shows whenever the state holds, so it has no dismiss (D352 5); the red one lists the scheduled runs due before
 * the run-out. A free user sees none (D360).
 */
export function CreditBanner() {
  const { data: meter } = useCreditMeter();
  const kind = meter ? pickCreditBanner(meter) : null;
  if (!meter || !kind) return null;
  const isRed = kind === "red";
  const credits = formatCredits(meter.paidAvailable);
  const Icon = isRed ? AlertCircle : AlertTriangle;
  const timeZone = meter.projection.status === "date" ? meter.projection.timeZone : undefined;
  return (
    <div
      role="status"
      aria-label="Credit warning"
      data-kind={kind}
      className={cn("flex shrink-0 flex-col gap-2 px-4 py-2.5 text-sm", isRed ? "bg-rx-red-tint text-rx-red-text" : "bg-rx-amber-tint text-rx-amber-text")}
    >
      <div className="flex items-center gap-3">
        <Icon className={cn("h-[18px] w-[18px] shrink-0", isRed ? "text-rx-red-bar" : "text-rx-amber-bar")} aria-hidden="true" />
        <p className="min-w-0 flex-1">
          {isRed ? "Almost out: " : kind === "amber" ? "Credits are running low: " : "Credits are below the minimum for your scheduled runs: "}
          <b className="font-mono font-semibold">{credits}</b>
          {isRed ? " credits left. " : " left. "}
          {(kind !== "amber" || meter.belowFloor) && "Scheduled runs may not complete. "}
          <Link href="/settings/billing" className="font-medium underline">
            {isRed ? "Top up now" : "Top up"}
          </Link>
        </p>
      </div>
      {isRed && timeZone && meter.dueReminders.length > 0 && (
        <div className="flex flex-col gap-1 pl-[30px] text-[13px]">
          <span className="font-semibold">Scheduled runs at risk</span>
          <ul aria-label="Scheduled runs at risk" className="flex flex-col gap-0.5">
            {meter.dueReminders.map((reminder) => (
              <li key={reminder.id}>
                {reminder.description ?? "Scheduled run"} · <span className="font-mono">{formatRunTime(reminder.nextRunAt, timeZone)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
