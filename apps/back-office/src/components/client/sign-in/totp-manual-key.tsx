"use client";

import { groupInFours } from "@/lib/sign-in/group-in-fours";
import { CopyButton } from "./copy-button";

/**
 * The TOTP key for entering by hand (RNX-333): shown in groups of four, spaced by layout only, so the text (and a
 * selection of it) is the key itself; Copy puts the whole key, ungrouped, on the clipboard.
 */
export function TotpManualKey({ secret }: { secret: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-rx-muted">Cannot scan? Enter this key by hand</span>
      <div className="flex items-center gap-2">
        <code className="flex min-w-0 flex-1 flex-wrap gap-x-[0.6em] rounded-rx border border-rx-line bg-rx-surface px-2.5 py-1.5 font-mono text-[13px] tracking-[0.06em]">
          {groupInFours(secret).map((group, index) => (
            <span key={index}>{group}</span>
          ))}
        </code>
        <CopyButton text={secret} label="Copy" className="h-9 px-3" />
      </div>
    </div>
  );
}
