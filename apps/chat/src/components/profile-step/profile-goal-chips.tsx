"use client";

import { BarChart3, Bell, FileText, MessageCircle, Search } from "lucide-react";
import { Button } from "@performa-ai/ui/components/button";
import { GOAL_OPTIONS } from "@/lib/profile-step-options";

const GOAL_ICONS: Record<(typeof GOAL_OPTIONS)[number], typeof FileText> = {
  "Reports and documents": FileText,
  "Data analysis": BarChart3,
  "Customer support": MessageCircle,
  "Internal knowledge search": Search,
  "Automation and reminders": Bell,
};

interface ProfileGoalChipsProps {
  selected: readonly string[];
  onToggle: (goal: string) => void;
}

/** "What do you want to do?": toggle buttons, one or more. */
export function ProfileGoalChips({ selected, onToggle }: ProfileGoalChipsProps) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-1.5 text-sm font-medium">What do you want to do? Pick one or more.</legend>
      <div className="flex flex-wrap gap-2.5">
        {GOAL_OPTIONS.map((goal) => {
          const isSelected = selected.includes(goal);
          const Icon = GOAL_ICONS[goal];
          return (
            <Button
              key={goal}
              type="button"
              variant="outline"
              className={`h-11 rounded-full px-4 text-[15px] ${isSelected ? "border-primary bg-accent text-accent-foreground hover:bg-accent" : ""}`}
              aria-pressed={isSelected}
              onClick={() => onToggle(goal)}
            >
              <Icon aria-hidden="true" />
              {goal}
            </Button>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground">Chooses the starter agent and the first tool we suggest.</span>
    </fieldset>
  );
}
