"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@performa-ai/ui/components/button";
import { cn } from "@performa-ai/ui/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@performa-ai/ui/components/tooltip";

const BASE_CLASS = "size-8 shrink-0 rounded-rx bg-transparent aria-expanded:bg-rx-surface";
/** The two looks: the destructive one takes its colour from the shared destructive role (`--destructive`, mapped by each app). */
const TONE_CLASS = {
  default: "border-rx-line text-rx-ink hover:bg-rx-surface focus-visible:ring-2 focus-visible:ring-rx-accent",
  destructive: "border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive",
} as const;

type IconActionButtonProps = {
  /** The action's title: the tooltip's text. */
  readonly title: string;
  /** The accessible name, when it must say more than the title (e.g. which row); the title otherwise. */
  readonly label?: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  /** For an action that opens and closes something in its row. */
  readonly isExpanded?: boolean;
  /** Disables the button (e.g. while the row's request is pending). */
  readonly isDisabled?: boolean;
  /** "destructive" for an action that deletes, revokes, removes or disconnects; "default" otherwise. */
  readonly tone?: keyof typeof TONE_CLASS;
};

/**
 * One action of a table row (D406): an icon-only button whose title shows in a tooltip on hover and on keyboard
 * focus, and is its accessible name.
 */
export function IconActionButton({ title, label = title, icon: Icon, onClick, isExpanded, isDisabled, tone = "default" }: IconActionButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" type="button" aria-label={label} aria-expanded={isExpanded} onClick={onClick} disabled={isDisabled} className={cn(BASE_CLASS, TONE_CLASS[tone])}>
            <Icon aria-hidden className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
