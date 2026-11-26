"use client";

import { Copy } from "lucide-react";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";

/**
 * Puts a package version's full id on the clipboard, for pasting where an id is asked for. Without a clipboard (an
 * insecure page, an old browser) or when the browser refuses, nothing happens: the id stays shown next to the button.
 */
export function CopyVersionIdButton({ versionId }: { readonly versionId: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(versionId);
    } catch {
      // Expected when the clipboard is missing or refused; the id is on screen to copy by hand.
    }
  };
  return (
    <IconActionButton title="Copy" label={`Copy id of version ${versionId}`} icon={Copy} onClick={() => void copy()} />
  );
}
