"use client";

import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";

type CopyButtonProps = {
  /** What goes on the clipboard, exactly as given. */
  readonly text: string;
  readonly label: string;
  readonly className?: string;
};

/**
 * Puts `text` on the clipboard (RNX-333: the TOTP key, the recovery codes) and then reads "Copied". The clipboard
 * may be unavailable or refused (an insecure origin, a denied permission): the label then stays as it was.
 */
export function CopyButton({ text, label, className }: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
    } catch {
      setIsCopied(false);
    }
  };
  return (
    <Button variant="outline" type="button" onClick={copy} className={`rounded-rx border-rx-line bg-rx-white font-medium text-rx-ink hover:border-rx-ink hover:bg-rx-white hover:text-rx-ink ${className ?? ""}`}>
      {isCopied ? "Copied" : label}
    </Button>
  );
}
