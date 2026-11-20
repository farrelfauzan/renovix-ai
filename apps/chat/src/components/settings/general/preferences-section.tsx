"use client";

import { useMemo, useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { ProfileStepSelect } from "@/components/profile-step/profile-step-select";
import type { CurrentUser } from "@/hooks/use-current-user";
import type { MyEntitlements } from "@/hooks/use-my-entitlements";
import { useUpdateProfile } from "@/hooks/use-update-profile";
import { buildCountryOptions } from "@/lib/build-country-options";
import { buildTierOptions } from "@/lib/build-tier-options";
import { buildTimeZoneOptions } from "@/lib/build-time-zone-options";
import { LANGUAGE_OPTIONS } from "@/lib/profile-step-options";

interface PreferencesSectionProps {
  user: CurrentUser;
  entitlements: MyEntitlements;
}

/**
 * RNX-77a: the Preferences section of Settings > General (artboard UserSettings). Its Save sends only this section's
 * fields. The language is stored and shown only: it changes no UI text (translation is a separate ticket). A saved
 * default tier the packages no longer allow is not preselected, so saving never sends a locked tier.
 */
export function PreferencesSection({ user, entitlements }: PreferencesSectionProps) {
  const updateProfile = useUpdateProfile();
  const [locale, setLocale] = useState(user.locale ?? "");
  const [country, setCountry] = useState(user.country ?? "");
  const [timezone, setTimezone] = useState(user.timezone ?? "");
  const [defaultModelTier, setDefaultModelTier] = useState(() =>
    user.defaultModelTier && entitlements.tiers.includes(user.defaultModelTier) ? user.defaultModelTier : "",
  );
  const countryOptions = useMemo(() => buildCountryOptions(), []);
  const timezoneOptions = useMemo(() => buildTimeZoneOptions({ current: timezone, supported: Intl.supportedValuesOf("timeZone") }), [timezone]);
  const tierOptions = useMemo(() => buildTierOptions(entitlements), [entitlements]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const fields = { locale, country, timezone, defaultModelTier };
    updateProfile.mutate(Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== "")));
  };

  return (
    <section aria-labelledby="settings-preferences" className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6">
      <h2 id="settings-preferences" className="text-lg font-semibold">
        Preferences
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <ProfileStepSelect
          id="settings-language"
          label="Interface and agent language"
          hint="Agents reply in this language unless you ask otherwise."
          placeholder="Choose your language"
          value={locale}
          options={LANGUAGE_OPTIONS}
          onChange={setLocale}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileStepSelect
            id="settings-country"
            label="Country"
            hint="Currency and number formats follow the country."
            placeholder="Choose your country"
            value={country}
            options={countryOptions}
            onChange={setCountry}
          />
          <ProfileStepSelect
            id="settings-timezone"
            label="Timezone"
            hint="Scheduled runs and reminders fire in this timezone."
            placeholder="Choose your timezone"
            value={timezone}
            options={timezoneOptions}
            onChange={setTimezone}
          />
        </div>
        <ProfileStepSelect
          id="settings-default-tier"
          label="Default model tier for new chats"
          hint="You can change the tier per conversation."
          placeholder="Choose a tier"
          value={defaultModelTier}
          options={tierOptions}
          onChange={setDefaultModelTier}
        />
        <div className="flex justify-end">
          <Button type="submit" className="h-(--rx-button-height) px-[22px]" disabled={updateProfile.isPending}>
            {updateProfile.isPending ? "Saving..." : "Save preferences"}
          </Button>
        </div>
      </form>
    </section>
  );
}
