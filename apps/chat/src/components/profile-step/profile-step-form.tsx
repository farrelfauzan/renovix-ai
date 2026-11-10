"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { ProfileStepSelect } from "@/components/profile-step/profile-step-select";
import { ProfileStepTopBar } from "@/components/profile-step/profile-step-top-bar";
import { ProfileGoalChips } from "@/components/profile-step/profile-goal-chips";
import type { CurrentUser } from "@/hooks/use-current-user";
import apiClient from "@/lib/api-client";
import { buildCountryOptions } from "@/lib/build-country-options";
import { buildTimeZoneOptions } from "@/lib/build-time-zone-options";
import { currentUserQueryKey } from "@/lib/current-user-query-key";
import { detectCountry } from "@/lib/detect-country";
import { detectLanguage } from "@/lib/detect-language";
import { detectTimeZone } from "@/lib/detect-time-zone";
import { GOAL_OPTIONS, LANGUAGE_OPTIONS, ROLE_OPTIONS } from "@/lib/profile-step-options";
import { resolveDefaultTimeZone } from "@/lib/resolve-default-time-zone";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { useAuthStore } from "@/lib/stores";

/**
 * RNX-33: the profile step (design artboard "Profile", step 1 of 3). Saves through PUT /auth/me/profile, then goes
 * to the page the user asked for (`redirect`), or home. There is no way past it without saving (D42: no skip).
 */
export function ProfileStepForm({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { email } = useAuthStore();
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState<string>(ROLE_OPTIONS.find((option) => option === user.jobTitle) ?? "");
  const [country, setCountry] = useState(user.country ?? detectCountry());
  const [timezone, setTimezone] = useState(() => resolveDefaultTimeZone({ detected: detectTimeZone(), country }));
  const [language, setLanguage] = useState<string>(detectLanguage());
  const [goals, setGoals] = useState<string[]>(() => GOAL_OPTIONS.filter((goal) => user.signupGoal?.includes(goal)));
  const [isSaving, setIsSaving] = useState(false);
  const countryOptions = useMemo(() => buildCountryOptions(), []);
  const timezoneOptions = useMemo(() => buildTimeZoneOptions({ current: timezone, supported: Intl.supportedValuesOf("timeZone") }), [timezone]);
  const isComplete = Boolean(name.trim() && role && country && timezone && language && goals.length > 0);

  const handleCountryChange = (value: string) => {
    setCountry(value);
    if (!timezone) setTimezone(resolveDefaultTimeZone({ detected: detectTimeZone(), country: value }));
  };

  const toggleGoal = (goal: string) =>
    setGoals((current) => (current.includes(goal) ? current.filter((item) => item !== goal) : [...current, goal]));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isComplete) return;
    setIsSaving(true);
    try {
      const saved = await apiClient.put<CurrentUser>("/auth/me/profile", {
        name: name.trim(),
        role,
        country,
        timezone,
        language,
        goal: goals.join(", "),
      });
      queryClient.setQueryData(currentUserQueryKey(email), saved);
      router.replace(safeRedirectPath(new URLSearchParams(window.location.search).get("redirect")));
    } catch {
      // The API client has already shown the error.
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <ProfileStepTopBar />
      <main className="flex flex-1 justify-center px-4 py-12 sm:px-8">
        <div className="flex w-full max-w-[720px] flex-col gap-7">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Welcome{user.name ? `, ${user.name}` : ""}. A few details so the agents know who they work for.
            </h1>
            <p className="text-[15px] text-muted-foreground">
              Takes under a minute. Each field says what it is used for. You can change or delete all of it in Settings.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-[22px] rounded-lg border bg-card p-4 sm:p-7">
            <div className="grid gap-[18px] sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor="profile-name" className="text-sm font-medium">
                  Your name
                </label>
                <Input
                  id="profile-name"
                  className="h-(--rx-button-height)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={100}
                />
                <span className="text-xs text-muted-foreground">Used in greetings and as your member name.</span>
              </div>
              <ProfileStepSelect
                id="profile-role"
                label="Your role"
                hint="Picks your first template agent."
                placeholder="Choose your role"
                value={role}
                options={ROLE_OPTIONS.map((option) => ({ value: option, label: option }))}
                onChange={setRole}
              />
            </div>
            <div className="grid gap-[18px] sm:grid-cols-3">
              <ProfileStepSelect
                id="profile-country"
                label="Country"
                hint="Sets currency and document formats."
                placeholder="Choose your country"
                value={country}
                options={countryOptions}
                onChange={handleCountryChange}
              />
              <ProfileStepSelect
                id="profile-timezone"
                label="Timezone"
                hint="Reminders run at the right hour."
                placeholder="Choose your timezone"
                value={timezone}
                options={timezoneOptions}
                onChange={setTimezone}
              />
              <ProfileStepSelect
                id="profile-language"
                label="Language"
                hint="Interface and agent replies."
                placeholder="Choose your language"
                value={language}
                options={LANGUAGE_OPTIONS}
                onChange={setLanguage}
              />
            </div>
            <ProfileGoalChips selected={goals} onToggle={toggleGoal} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <span className="max-w-[52ch] text-[13px] text-muted-foreground">
                Stored under Indonesia&apos;s personal data protection law (UU PDP). Nothing here is shared with model providers beyond
                the company name and language inside your own agents.
              </span>
              <Button type="submit" className="h-(--rx-button-height) px-[22px]" disabled={!isComplete || isSaving}>
                {isSaving ? "Saving..." : "Continue"}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
