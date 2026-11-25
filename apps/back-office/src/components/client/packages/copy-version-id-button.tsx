"use client";

import { Button } from "@performa-ai/ui/components/button";

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
    <Button variant="outline" type="button" aria-label={`Copy id of version ${versionId}`} onClick={copy} className="rounded-rx border border-rx-line px-2 py-0 text-xs h-auto bg-transparent font-normal whitespace-normal">Copy</Button>
  );
}
