const STEPS = ["About you", "First agent", "First result"] as const;

/**
 * The setup progress of the top bar (design artboard "Profile"): step 1 of 3 is the current one.
 * Below `sm` the three steps stay on one line, and the other steps show only their number; their
 * labels stay in the accessibility tree.
 */
export function ProfileStepStepper() {
  return (
    <nav aria-label="Setup progress" className="flex w-full flex-nowrap gap-5 sm:w-auto sm:flex-wrap">
      {STEPS.map((step, index) => {
        const isCurrent = index === 0;
        return (
          <span key={step} aria-current={isCurrent ? "step" : undefined} className="flex items-center gap-2 whitespace-nowrap text-sm">
            <span
              aria-hidden="true"
              className={`inline-flex size-[26px] shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold ${
                isCurrent ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
              }`}
            >
              {index + 1}
            </span>
            <span className={isCurrent ? undefined : "sr-only sm:not-sr-only"}>{step}</span>
          </span>
        );
      })}
    </nav>
  );
}
