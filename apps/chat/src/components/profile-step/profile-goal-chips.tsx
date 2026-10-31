"use client";

import { Button } from "@/components/ui/button";
import { GOAL_OPTIONS } from "@/lib/profile-step-options";

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
          return (
            <Button
              key={goal}
              type="button"
              variant={isSelected ? "default" : "outline"}
              className="rounded-full"
              aria-pressed={isSelected}
              onClick={() => onToggle(goal)}
            >
              {goal}
            </Button>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground">Chooses the starter agent and the first tool we suggest.</span>
    </fieldset>
  );
}
