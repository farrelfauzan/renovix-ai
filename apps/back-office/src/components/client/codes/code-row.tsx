"use client";

import type { InvitationCode } from "@/lib/codes/invitation-code";
import type { CodeRedemption } from "@/lib/codes/code-redemption";
import { RedemptionsList } from "./redemptions-list";

type CodeRowProps = {
  readonly code: InvitationCode;
  /** Set while the redemptions are shown. */
  readonly redemptions: readonly CodeRedemption[] | null;
  readonly onToggleRedemptions: () => void;
  readonly onDeactivate: () => void;
};

const BUTTON = "rounded-rx border border-rx-line px-3 py-1 text-sm";

/** What a code grants, as one line. */
function describeGrant({ creditAmount, packageVersion }: InvitationCode): string {
  return [creditAmount && `${Number(creditAmount)} credits`, packageVersion && `package ${packageVersion.package.name}`].filter(Boolean).join(" + ");
}

/** One invitation code with its use, a button to see its redemptions and, while active, one to deactivate it. */
export function CodeRow({ code, redemptions, onToggleRedemptions, onDeactivate }: CodeRowProps) {
  return (
    <>
      <tr className="border-t border-rx-line align-top">
        <td className="py-2 pr-3 font-mono">{code.code}</td>
        <td className="py-2 pr-3">{describeGrant(code)}</td>
        <td className="py-2 pr-3">{code._count.redemptions} / {code.maxRedemptions}</td>
        <td className="py-2 pr-3">{new Date(code.expiresAt).toLocaleDateString("en-GB")}</td>
        <td className="py-2 pr-3">{code.isActive ? "Active" : "Deactivated"}</td>
        <td className="flex flex-wrap gap-2 py-2">
          <button type="button" onClick={onToggleRedemptions} aria-expanded={redemptions !== null} className={BUTTON}>Redemptions</button>
          {code.isActive && <button type="button" onClick={onDeactivate} className={BUTTON}>Deactivate</button>}
        </td>
      </tr>
      {redemptions && (
        <tr>
          <td colSpan={6} className="pb-3"><RedemptionsList redemptions={redemptions} /></td>
        </tr>
      )}
    </>
  );
}
