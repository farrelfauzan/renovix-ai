"use client";

import { useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

interface ShowOnceKeyCardProps {
  keyName: string;
  prefix: string;
  apiKey: string;
  onDoneAction: () => void;
}

/** Shows a new key in full, this once, with Copy and "Done, I saved it" (which drops it from memory). */
export function ShowOnceKeyCard({ keyName, prefix, apiKey, onDoneAction }: ShowOnceKeyCardProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      toast.error("Could not copy. Select the key and copy it.");
    }
  };
  return (
    <section className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4" aria-label="New API key">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Your new key “{keyName}” is ready</h2>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">shown once</span>
      </div>
      <code className="block overflow-x-auto rounded border border-border/50 bg-background px-3 py-2 font-mono text-xs">{apiKey}</code>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleCopy}>
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="outline" onClick={onDoneAction}>
          Done, I saved it
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Store it in your app&apos;s secret manager. Once you close this, only the prefix <span className="font-mono">{prefix}…</span> stays visible.
      </p>
    </section>
  );
}
