"use client";

import { Button } from "@performa-ai/ui/components/button";

interface ApiKeysErrorProps {
  onRetryAction: () => void;
}

/** Shown when GET /auth/keys fails; Retry asks the list to fetch again. */
export function ApiKeysError({ onRetryAction }: ApiKeysErrorProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <p className="text-muted-foreground">Couldn&apos;t load your API keys.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetryAction}>
        Retry
      </Button>
    </div>
  );
}
