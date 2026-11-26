"use client";

import { Pencil } from "lucide-react";
import { formatSettingValue } from "@/lib/settings/format-setting-value";
import { isEditableSetting } from "@/lib/settings/is-editable-setting";
import type { PlatformSetting } from "@/lib/settings/platform-setting";
import type { SettingDescription } from "@/lib/settings/setting-description";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";

type SettingRowProps = {
  readonly setting: PlatformSetting;
  readonly description: SettingDescription;
  readonly canWrite: boolean;
  readonly onEdit: () => void;
};

/**
 * One setting with its value ("not set" while it has none), its "not applied yet" label where it applies, and an Edit
 * button for `settings:write`. A boolean or list setting is read-only, with a note saying so (RNX-315).
 */
export function SettingRow({ setting, description, canWrite, onEdit }: SettingRowProps) {
  const isEditable = isEditableSetting(description, setting.value);
  return (
    <tr className="border-t border-rx-line align-top">
      <td className="px-3 py-2">
        {description.label}
        {description.isNotAppliedYet && <span className="ml-2 rounded-rx-pill bg-rx-amber-tint px-2 py-0.5 text-xs text-rx-amber-text">not applied yet</span>}
      </td>
      <td className="px-3 py-2 font-mono">{formatSettingValue(setting.value)}</td>
      <td className="px-3 py-2">
        {isEditable && canWrite && <IconActionButton title="Edit" label={`Edit ${description.label}`} icon={Pencil} onClick={onEdit} />}
        {!isEditable && <span className="text-xs text-rx-muted">Read-only: this screen edits number settings only.</span>}
      </td>
    </tr>
  );
}
