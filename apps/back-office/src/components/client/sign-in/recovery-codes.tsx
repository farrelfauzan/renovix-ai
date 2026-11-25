"use client";

import { useId, useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Checkbox } from "@performa-ai/ui/components/checkbox";
import { downloadTextFile } from "@/lib/sign-in/download-text-file";
import { CopyButton } from "./copy-button";

const FILE_NAME = "renovix-admin-recovery-codes.txt";
const GHOST_BUTTON = "h-10 flex-1 rounded-rx border-rx-line bg-rx-white font-medium text-rx-ink hover:border-rx-ink hover:bg-rx-white hover:text-rx-ink";

/**
 * The recovery codes the API returns once at the end of the TOTP enrolment (RX-94), as the canvas's Invite artboard
 * draws them (RNX-333): two columns, a .txt download built in the browser and Copy all (one code per line), and
 * Finish only once the admin ticks that the codes are saved.
 */
export function RecoveryCodes({ codes, onContinue }: { codes: readonly string[]; onContinue: () => void }) {
  const [hasSaved, setHasSaved] = useState(false);
  const checkboxId = useId();
  const text = `${codes.join("\n")}\n`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold tracking-[-0.01em]">Save your recovery codes</h2>
        <p className="text-[13px] text-rx-muted">Shown once. Each code signs you in once if you lose the authenticator. Keep them in your password manager.</p>
      </div>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-rx border border-rx-line bg-rx-surface px-3.5 py-3 font-mono text-[13px]">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="outline" type="button" onClick={() => downloadTextFile(FILE_NAME, text)} className={GHOST_BUTTON}>
          Download .txt
        </Button>
        <CopyButton text={text} label="Copy all" className="h-10 flex-1" />
      </div>
      <div className="flex items-start gap-2.5 text-[13px]">
        <Checkbox id={checkboxId} checked={hasSaved} onCheckedChange={(checked) => setHasSaved(checked === true)} className="mt-0.5" />
        <label htmlFor={checkboxId}>I have saved these codes somewhere safe. I understand they will not be shown again.</label>
      </div>
      <Button type="button" disabled={!hasSaved} onClick={onContinue} className="h-11 w-full rounded-rx bg-rx-accent text-rx-on-accent hover:bg-rx-accent-hover">
        Finish
      </Button>
    </div>
  );
}
