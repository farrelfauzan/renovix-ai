"use client";

import Link from "next/link";
import { cn } from "@performa-ai/ui/lib/utils";
import { useCreditMeter } from "@/hooks/use-credit-meter";
import { formatCredits } from "@/lib/format-credits";
import { isFreeCreditUser } from "@/lib/is-free-credit-user";
import { runOutText } from "@/lib/run-out-text";

/**
 * The sidebar credit meter (RNX-330): paid credits left and the projected run-out, or for a free user the weekly
 * allowance left with paid credits shown separately and no projection. Renders nothing while loading or on error.
 */
export function SidebarCreditMeter() {
  const { data: meter } = useCreditMeter();
  if (!meter) return null;
  const isFree = isFreeCreditUser(meter);
  return (
    <div className="flex flex-col gap-1 border-t border-sidebar-border p-3 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:group-data-[state=collapsed]:hidden">
      <div className="flex items-baseline justify-between text-[13px] text-sidebar-foreground">
        <span className="font-medium">{isFree ? "Free allowance" : "Credits"}</span>
        <span className={cn("font-mono", meter.level === "red" && !isFree && "text-rx-red-bar")}>
          {formatCredits(isFree ? meter.weeklyFreeAvailable : meter.paidAvailable)}
        </span>
      </div>
      {isFree ? (
        <>
          <span>Left this week</span>
          <div className="flex items-baseline justify-between">
            <span>Paid credits</span>
            <span className="font-mono">{formatCredits(meter.paidAvailable)}</span>
          </div>
        </>
      ) : (
        <span>{runOutText(meter.projection)}</span>
      )}
      <Link href="/settings/billing" className="text-primary hover:underline">
        Top up
      </Link>
    </div>
  );
}
