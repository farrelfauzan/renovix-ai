"use client";

import { useState } from "react";
import { useApiKeys, useRevokeApiKey } from "@/hooks/use-api-keys";
import { useMyEntitlements } from "@/hooks/use-my-entitlements";
import type { CreatedApiKey } from "@/lib/api-key-types";
import { CreateKeyForm } from "./create-key-form";
import { KeysTable } from "./keys-table";
import { QuickStart } from "./quick-start";
import { ShowOnceKeyCard } from "./show-once-key-card";

/**
 * The API keys page: show-once card, keys table, create form and quick start. The full key of a new key lives only in
 * this component's state until "Done, I saved it" (or the page is left); it is never put in a cache or in storage.
 */
export function ApiKeysSection() {
  const { data: entitlements } = useMyEntitlements();
  const { data: keys = [] } = useApiKeys();
  const revoke = useRevokeApiKey();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-xl font-semibold">API keys</h1>
      <p className="text-sm text-muted-foreground">
        Call the same models from your own software. Requests spend the same credits as the app and stop with HTTP 402 when you are out of credits. Keys are shown once and stored hashed.
      </p>
      {created && (
        <ShowOnceKeyCard keyName={created.name} prefix={created.prefix} apiKey={created.apiKey} onDoneAction={() => setCreated(null)} />
      )}
      <KeysTable keys={keys} onRevokeAction={(keyId) => revoke.mutate(keyId)} />
      {entitlements && (
        <CreateKeyForm
          offeredTiers={entitlements.tiers}
          hasApiAccess={entitlements.apiAccess}
          nextPackage={entitlements.apiAccessNextPackage}
          onCreatedAction={setCreated}
        />
      )}
      <QuickStart />
    </div>
  );
}
