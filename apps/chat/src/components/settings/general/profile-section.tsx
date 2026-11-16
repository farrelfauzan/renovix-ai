"use client";

import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { ProfileGoalChips } from "@/components/profile-step/profile-goal-chips";
import { ProfileStepSelect } from "@/components/profile-step/profile-step-select";
import { SettingsTextField } from "@/components/settings/general/settings-text-field";
import type { CurrentUser } from "@/hooks/use-current-user";
import { useUpdateProfile } from "@/hooks/use-update-profile";
import { GOAL_OPTIONS, ROLE_OPTIONS } from "@/lib/profile-step-options";

/** The API's limits on these fields (PATCH /auth/me). */
const NAME_MAX_LENGTH = 100;
const JOB_TITLE_MAX_LENGTH = 100;
const PHONE_MAX_LENGTH = 20;

/**
 * RNX-77a: the Profile section of Settings > General (artboard UserSettings). Its Save sends only this section's
 * fields. The photo is RNX-334.
 */
export function ProfileSection({ user }: { user: CurrentUser }) {
  const updateProfile = useUpdateProfile();
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState<string>(ROLE_OPTIONS.find((option) => option === user.role) ?? "");
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [goals, setGoals] = useState<string[]>(() => GOAL_OPTIONS.filter((goal) => user.signupGoal?.includes(goal)));
  const canSave = Boolean(name.trim() && role && goals.length > 0) && !updateProfile.isPending;

  const toggleGoal = (goal: string) =>
    setGoals((current) => (current.includes(goal) ? current.filter((item) => item !== goal) : [...current, goal]));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    updateProfile.mutate({
      name: name.trim(),
      role,
      jobTitle: jobTitle.trim(),
      phone: phone.trim(),
      signupGoal: GOAL_OPTIONS.filter((goal) => goals.includes(goal)).join(", "),
    });
  };

  return (
    <section aria-labelledby="settings-profile" className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="settings-profile" className="text-lg font-semibold">
          Profile
        </h2>
        <span className="text-[13px] text-muted-foreground">What agents and teammates see. Each field says what it is used for.</span>
      </div>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <SettingsTextField id="settings-name" label="Full name" hint="Greetings, member lists, receipts." value={name} maxLength={NAME_MAX_LENGTH} onChange={setName} />
        <ProfileStepSelect
          id="settings-role"
          label="Role"
          hint="Template suggestions and agent context."
          placeholder="Choose your role"
          value={role}
          options={ROLE_OPTIONS.map((option) => ({ value: option, label: option }))}
          onChange={setRole}
        />
        <SettingsTextField
          id="settings-job-title"
          label="Job title (optional)"
          hint="Shown to teammates and in agent context."
          value={jobTitle}
          maxLength={JOB_TITLE_MAX_LENGTH}
          onChange={setJobTitle}
        />
        <SettingsTextField
          id="settings-phone"
          label="Phone or WhatsApp (optional)"
          hint="Reminders over WhatsApp on Enterprise."
          type="tel"
          value={phone}
          maxLength={PHONE_MAX_LENGTH}
          onChange={setPhone}
        />
        <div className="sm:col-span-2">
          <ProfileGoalChips selected={goals} onToggle={toggleGoal} legend="What you use Renovix for" hint="Orders template agents and suggested tools." />
        </div>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" className="h-(--rx-button-height) px-[22px]" disabled={!canSave}>
            {updateProfile.isPending ? "Saving..." : "Save profile"}
          </Button>
        </div>
      </form>
    </section>
  );
}
