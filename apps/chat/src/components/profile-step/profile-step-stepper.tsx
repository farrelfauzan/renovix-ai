const STEPS = ["About you", "First agent", "First result"] as const;

/** The setup progress of the top bar (design artboard "Profile"): step 1 of 3 is the current one. */
export function ProfileStepStepper() {
  return (
    <nav aria-label="Setup progress" className="flex flex-wrap gap-5">
      {STEPS.map((step, index) => {
        const isCurrent = index === 0;
        return (
          <span key={step} aria-current={isCurrent ? "step" : undefined} className="flex items-center gap-2 text-sm">
            <span
              className={`inline-flex size-[26px] items-center justify-center rounded-full border text-[13px] font-semibold ${
                isCurrent ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
              }`}
            >
              {index + 1}
            </span>
            {step}
          </span>
        );
      })}
    </nav>
  );
}
