"use client";

import type { PlatformSetting } from "@/lib/settings/platform-setting";
import type { SettingDescription } from "@/lib/settings/setting-description";

type SettingRowProps = {
  readonly setting: PlatformSetting;
  readonly description: SettingDescription;
  readonly canWrite: boolean;
  readonly onEdit: () => void;
};

/** One setting with its value ("not set" while it has none), its "not applied yet" label where it applies, and an Edit button for `settings:write`. */
export function SettingRow({ setting, description, canWrite, onEdit }: SettingRowProps) {
  return (
    <tr className="border-t border-rx-line align-top">
      <td className="py-2 pr-3">
        {description.label}
        {description.isNotAppliedYet && <span className="ml-2 rounded-rx-pill bg-rx-amber-tint px-2 py-0.5 text-xs text-rx-amber-text">not applied yet</span>}
      </td>
      <td className="py-2 pr-3 font-mono">{setting.value === null ? "not set" : setting.value}</td>
      <td className="py-2">{canWrite && <button type="button" onClick={onEdit} aria-label={`Edit ${description.label}`} className="rounded-rx border border-rx-line px-3 py-1 text-sm">Edit</button>}</td>
    </tr>
  );
}
