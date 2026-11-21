import { Skeleton } from "@performa-ai/ui/components/skeleton";

/** Placeholder shown while the API keys list is being fetched for the first time. */
export function ApiKeysLoading() {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Loading keys…</p>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
