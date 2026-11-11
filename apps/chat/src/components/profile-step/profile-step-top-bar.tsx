import { RenovixLogo } from "@/components/brand/renovix-logo";
import { ProfileStepStepper } from "@/components/profile-step/profile-step-stepper";

/** The top bar of the profile step: the logo and the three-step progress. No skip link (D42). */
export function ProfileStepTopBar() {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex min-h-16 max-w-[1040px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-8 sm:py-0">
        <RenovixLogo layout="horizontal" size={26} />
        <ProfileStepStepper />
      </div>
    </header>
  );
}
