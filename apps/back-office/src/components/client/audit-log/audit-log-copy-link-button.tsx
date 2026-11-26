"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import type { AuditLogFilters } from "@/lib/audit-log/audit-log-filters";
import { buildAuditLogSearch } from "@/lib/audit-log/build-audit-log-search";

/** Copies the absolute URL of the audit log view with the applied `filters` (RX-371) and says so. */
export function AuditLogCopyLinkButton({ filters }: { filters: AuditLogFilters }) {
  const pathname = usePathname();
  const [message, setMessage] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${pathname}${buildAuditLogSearch(filters)}`);
      setMessage("Link copied");
    } catch {
      setMessage("The link could not be copied");
    }
  };
  return (
    <>
      <Button variant="outline" type="button" onClick={copy} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">
        Copy link
      </Button>
      <span role="status" className="text-sm text-rx-muted">{message}</span>
    </>
  );
}
