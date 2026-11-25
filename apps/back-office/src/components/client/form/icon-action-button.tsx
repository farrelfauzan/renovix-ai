"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@performa-ai/ui/components/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@performa-ai/ui/components/tooltip";

type IconActionButtonProps = {
  /** The action's title: the tooltip's text. */
  readonly title: string;
  /** The accessible name, when it must say more than the title (e.g. which row); the title otherwise. */
  readonly label?: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  /** For an action that opens and closes something in its row. */
  readonly isExpanded?: boolean;
};

/**
 * One action of a table row (D406): an icon-only button whose title shows in a tooltip on hover and on keyboard
 * focus, and is its accessible name.
 */
export function IconActionButton({ title, label = title, icon: Icon, onClick, isExpanded }: IconActionButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" type="button" aria-label={label} aria-expanded={isExpanded} onClick={onClick} className="size-8 shrink-0 rounded-rx border-rx-line bg-transparent text-rx-ink hover:bg-rx-surface focus-visible:ring-2 focus-visible:ring-rx-accent aria-expanded:bg-rx-surface">
            <Icon aria-hidden className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
