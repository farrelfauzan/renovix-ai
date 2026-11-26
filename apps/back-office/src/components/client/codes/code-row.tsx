"use client";

import { Ban, ListChecks } from "lucide-react";
import type { InvitationCode } from "@/lib/codes/invitation-code";
import type { CodeRedemption } from "@/lib/codes/code-redemption";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";
import { RedemptionsList } from "./redemptions-list";

type CodeRowProps = {
  readonly code: InvitationCode;
  /** Set while the redemptions are shown. */
  readonly redemptions: readonly CodeRedemption[] | null;
  readonly onToggleRedemptions: () => void;
  readonly onDeactivate: () => void;
};

/** What a code grants, as one line. */
function describeGrant({ creditAmount, packageVersion }: InvitationCode): string {
  return [creditAmount && `${Number(creditAmount)} credits`, packageVersion && `package ${packageVersion.package.name}`].filter(Boolean).join(" + ");
}

/** One invitation code with its use, a button to see its redemptions and, while active, one to deactivate it. */
export function CodeRow({ code, redemptions, onToggleRedemptions, onDeactivate }: CodeRowProps) {
  return (
    <>
      <tr className="border-t border-rx-line align-top">
        <td className="px-3 py-2 font-mono">{code.code}</td>
        <td className="px-3 py-2">{describeGrant(code)}</td>
        <td className="px-3 py-2">{code._count.redemptions} / {code.maxRedemptions}</td>
        <td className="px-3 py-2">{new Date(code.expiresAt).toLocaleDateString("en-GB")}</td>
        <td className="px-3 py-2">{code.isActive ? "Active" : "Deactivated"}</td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-2">
            <IconActionButton title="Redemptions" icon={ListChecks} onClick={onToggleRedemptions} isExpanded={redemptions !== null} />
            {code.isActive && <IconActionButton title="Deactivate" icon={Ban} onClick={onDeactivate} />}
          </div>
        </td>
      </tr>
      {redemptions && (
        <tr>
          <td colSpan={6} className="px-3 pb-3"><RedemptionsList redemptions={redemptions} /></td>
        </tr>
      )}
    </>
  );
}
