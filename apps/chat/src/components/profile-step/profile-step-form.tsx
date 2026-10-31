"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProfileStepSelect } from "@/components/profile-step/profile-step-select";
import { ProfileGoalChips } from "@/components/profile-step/profile-goal-chips";
import type { CurrentUser } from "@/hooks/use-current-user";
import apiClient from "@/lib/api-client";
import { COUNTRY_CODES } from "@/lib/country-codes";
import { currentUserQueryKey } from "@/lib/current-user-query-key";
import { detectCountry } from "@/lib/detect-country";
import { detectLanguage } from "@/lib/detect-language";
import { detectTimeZone } from "@/lib/detect-time-zone";
import { GOAL_OPTIONS, LANGUAGE_OPTIONS, ROLE_OPTIONS } from "@/lib/profile-step-options";
import { resolveDefaultTimeZone } from "@/lib/resolve-default-time-zone";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { useAuthStore } from "@/lib/stores";

/** The countries offered first (the design's list); the rest follow by name. */
const FIRST_COUNTRIES = ["ID", "SG", "MY"];

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
  const countryOptions = useMemo(() => {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    const rest = COUNTRY_CODES.filter((code) => !FIRST_COUNTRIES.includes(code));
    const sorted = rest.map((code) => ({ value: code, label: names.of(code) ?? code })).sort((a, b) => a.label.localeCompare(b.label));
    return [...FIRST_COUNTRIES.map((code) => ({ value: code, label: names.of(code) ?? code })), ...sorted];
  }, []);
  const timezoneOptions = useMemo(() => {
    const zones = new Set([timezone, ...Intl.supportedValuesOf("timeZone")].filter(Boolean));
    return [...zones].map((zone) => ({ value: zone, label: zone }));
  }, [timezone]);
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
    <main className="flex min-h-screen justify-center px-4 py-12 sm:px-8">
      <div className="flex w-full max-w-3xl flex-col gap-7">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Step 1 of 3 · About you</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Welcome{user.name ? `, ${user.name}` : ""}. A few details so the agents know who they work for.
          </h1>
          <p className="text-sm text-muted-foreground">Takes under a minute. Each field says what it is used for.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6 rounded-lg border bg-card p-6 sm:p-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="profile-name" className="text-sm font-medium">
                Your name
              </label>
              <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
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
          <div className="grid gap-4 sm:grid-cols-3">
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
          <div className="flex justify-end border-t pt-5">
            <Button type="submit" disabled={!isComplete || isSaving}>
              {isSaving ? "Saving..." : "Continue"}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
