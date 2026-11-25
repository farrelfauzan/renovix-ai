"use client";

import { useEffect, useState } from "react";
import { describeSessionTimeLeft } from "@/lib/session/describe-session-time-left";

/** How often the line is redrawn from the stored times: a local timer only, never a request (D332). */
const REDRAW_MS = 15_000;

type SessionTimeLeftProps = {
  /** From the session gate's last `/me` answer. */
  readonly idleExpiresAt: string;
  /** From the session gate's last `/me` answer. */
  readonly absoluteExpiresAt: string;
};

/** The approximate time left to the sooner session limit (RNX-312a, D353 Q4, RNX-346), counted from the last `/me` answer without polling it. */
export function SessionTimeLeft({ idleExpiresAt, absoluteExpiresAt }: SessionTimeLeftProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), REDRAW_MS);
    return () => clearInterval(timer);
  }, [idleExpiresAt, absoluteExpiresAt]);
  return <span>{describeSessionTimeLeft({ idleExpiresAt, absoluteExpiresAt, now })}</span>;
}
