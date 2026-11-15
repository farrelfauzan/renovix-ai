"use client";

import { useState } from "react";
import { Badge } from "@performa-ai/ui/components/badge";
import { Button } from "@performa-ai/ui/components/button";
import { formatKeyPrefix } from "@/lib/format-key-prefix";
import type { ApiKeyListItem } from "@/lib/api-key-types";
import { RevokeKeyDialog } from "./revoke-key-dialog";

interface KeyRowProps {
  apiKey: ApiKeyListItem;
  onRevokeAction: (keyId: string) => void;
}

const formatDate = (value: string | null): string => (value ? new Date(value).toLocaleDateString() : "never");

/** One row of the keys table: its prefix only, never the full key. */
export function KeyRow({ apiKey, onRevokeAction }: KeyRowProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  return (
    <tr className="border-t border-border/50">
      <td className="px-3 py-2">{apiKey.name}</td>
      <td className="px-3 py-2 font-mono">{formatKeyPrefix(apiKey.prefix)}</td>
      <td className="px-3 py-2 capitalize">{apiKey.allowedTiers.join(", ")}</td>
      <td className="px-3 py-2">{new Date(apiKey.createdAt).toLocaleDateString()}</td>
      <td className="px-3 py-2 text-muted-foreground">{formatDate(apiKey.lastUsedAt)}</td>
      <td className="px-3 py-2">{apiKey.creditsLast30Days}</td>
      <td className="px-3 py-2">
        {apiKey.revokedAt ? (
          <Badge variant="outline">revoked</Badge>
        ) : (
          <>
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setIsConfirming(true)}>
              Revoke
            </Button>
            <RevokeKeyDialog
              keyName={apiKey.name}
              open={isConfirming}
              onOpenChangeAction={setIsConfirming}
              onConfirmAction={() => onRevokeAction(apiKey.id)}
            />
          </>
        )}
      </td>
    </tr>
  );
}
