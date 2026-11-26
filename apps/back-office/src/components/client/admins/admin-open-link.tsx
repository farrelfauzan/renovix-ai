"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@performa-ai/ui/components/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@performa-ai/ui/components/tooltip";

type AdminOpenLinkProps = {
  readonly id: string;
  readonly email: string;
};

/**
 * The one action of an admins row (RNX-373, D443): an icon-only link to the admin's page, with the look and tooltip
 * of the shared icon action button. That button is a button with a click handler; this one navigates, so it is a
 * link (it can be opened in a new tab and is announced as a link).
 */
export function AdminOpenLink({ id, email }: AdminOpenLinkProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="outline" size="icon" className="size-8 shrink-0 rounded-rx border-rx-line bg-transparent text-rx-ink hover:bg-rx-surface focus-visible:ring-2 focus-visible:ring-rx-accent">
            <Link href={`/admins-and-roles/${encodeURIComponent(id)}`} aria-label={`Open admin ${email}`}>
              <ExternalLink aria-hidden className="size-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
