"use client";

import { Button } from "@performa-ai/ui/components/button";

/** Puts a package version's full id on the clipboard, for pasting where an id is asked for. */
export function CopyVersionIdButton({ versionId }: { readonly versionId: string }) {
  return (
    <Button variant="outline" type="button" aria-label={`Copy id of version ${versionId}`} onClick={() => navigator.clipboard.writeText(versionId)} className="rounded-rx border border-rx-line px-2 py-0 text-xs h-auto bg-transparent font-normal whitespace-normal">Copy</Button>
  );
}
