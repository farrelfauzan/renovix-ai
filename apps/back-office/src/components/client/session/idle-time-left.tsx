"use client";

import { useEffect, useState } from "react";
import { describeIdleTimeLeft } from "@/lib/session/describe-idle-time-left";

/** How often the line is redrawn from the stored time: a local timer only, never a request (D332). */
const REDRAW_MS = 15_000;

type IdleTimeLeftProps = {
  /** From the session gate's last `/me` answer. */
  readonly idleExpiresAt: string;
};

/** The approximate idle time left (RNX-312a, D353 Q4), counted from the last `/me` answer without polling it. */
export function IdleTimeLeft({ idleExpiresAt }: IdleTimeLeftProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), REDRAW_MS);
    return () => clearInterval(timer);
  }, [idleExpiresAt]);
  return <span>{describeIdleTimeLeft(idleExpiresAt, now)}</span>;
}
