import { Badge } from "@performa-ai/ui/components/badge";
import type { ActiveSession } from "@/hooks/use-active-sessions";

/** RNX-78: one active session: the device and when it was last active. No location (none is stored). */
export function SessionRow({ session }: { session: ActiveSession }) {
  const lastActive = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.lastActiveAt));
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t py-3 first:border-t-0 first:pt-0">
      <span className="inline-flex items-center gap-2 text-sm font-medium">
        {session.device}
        {session.isCurrent ? <Badge variant="secondary">This device</Badge> : null}
      </span>
      <span className="text-[13px] text-muted-foreground">Last active {lastActive}</span>
    </li>
  );
}
