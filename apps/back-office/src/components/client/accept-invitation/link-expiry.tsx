"use client";

import { useEffect, useState } from "react";
import { describeLinkExpiry } from "@/lib/invitation/describe-link-expiry";

/** How often the line is redrawn from the preview's expiry: a local timer only, never a request. */
const REDRAW_MS = 15_000;

/** The invitation link's time left (RNX-333), counted from the preview's `expiresAt` without asking the API again. */
export function LinkExpiry({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), REDRAW_MS);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return <span className="font-mono text-[11px] text-rx-dark-muted">{describeLinkExpiry(expiresAt, now)}</span>;
}
