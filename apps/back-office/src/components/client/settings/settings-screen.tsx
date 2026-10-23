"use client";

import { useCallback, useEffect, useState } from "react";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import { defaultSessionApi } from "@/lib/session/default-session-api";
import type { SessionApi } from "@/lib/session/session-api";
import { useAdminProfile } from "@/lib/session/use-admin-profile";
import { defaultSettingsApi } from "@/lib/settings/default-settings-api";
import type { PlatformSetting } from "@/lib/settings/platform-setting";
import type { SettingDescription } from "@/lib/settings/setting-description";
import { SETTING_DESCRIPTIONS } from "@/lib/settings/setting-descriptions";
import type { SettingsApi } from "@/lib/settings/settings-api";
import { SettingForm } from "./setting-form";
import { SettingRow } from "./setting-row";

type SettingsScreenProps = {
  /** Replaced in tests only. */
  readonly api?: SettingsApi;
  readonly sessionApi?: SessionApi;
};

/** A setting the screen has no description for (a name the API added) is shown by its name as a whole number. */
const describe = (name: string): SettingDescription => SETTING_DESCRIPTIONS[name] ?? { label: name, unit: "count", min: 0 };

/**
 * The platform settings (RNX-98, PRD 09 F6): every setting of the API's registry with its value and, for an admin
 * with `settings:write`, an edit form with a reason (visibility only: the API validates, enforces and audits).
 */
export function SettingsScreen({ api = defaultSettingsApi, sessionApi = defaultSessionApi }: SettingsScreenProps) {
  const profile = useAdminProfile(sessionApi);
  const [settings, setSettings] = useState<readonly PlatformSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformSetting | null>(null);
  const canRead = profile?.permissions.includes("settings:read") ?? false;
  const canWrite = profile?.permissions.includes("settings:write") ?? false;
  const load = useCallback(async () => {
    try {
      setSettings(await api.listSettings());
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, [api]);
  useEffect(() => {
    if (canRead) load();
  }, [canRead, load]);
  const save = async (name: string, value: number, reason: string): Promise<string | null> => {
    try {
      await api.saveSetting(name, value, reason);
    } catch (err) {
      return describeFailure(err);
    }
    await load();
    return null;
  };
  if (!profile) return <p className="mt-4 text-sm text-rx-muted">Loading…</p>;
  if (!canRead) return <p className="mt-4 text-sm text-rx-muted">Your role cannot view the platform settings (settings:read).</p>;
  return (
    <div className="mt-4">
      {error && <p role="alert" className="text-sm text-rx-red-bar">{error}</p>}
      {editing && <div className="mb-4"><SettingForm key={editing.name} setting={editing} description={describe(editing.name)} onSave={(value, reason) => save(editing.name, value, reason)} onClose={() => setEditing(null)} /></div>}
      {settings && settings.length === 0 && <p className="text-sm text-rx-muted">No settings.</p>}
      {settings && settings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="text-rx-muted">
              <tr>
                <th className="pr-3 font-normal">Setting</th>
                <th className="pr-3 font-normal">Value</th>
                <th className="font-normal"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {settings.map((setting) => (
                <SettingRow key={setting.name} setting={setting} description={describe(setting.name)} canWrite={canWrite} onEdit={() => setEditing(setting)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
