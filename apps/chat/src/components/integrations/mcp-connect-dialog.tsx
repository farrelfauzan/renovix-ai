"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ExternalLink } from "lucide-react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@performa-ai/ui/components/dialog";
import { useStartUserOAuth, useConnectWithToken } from "@/hooks/use-user-mcp";
import type { McpRegistryEntry } from "@/lib/mcp-types";

type McpConnectDialogProps = {
  provider: McpRegistryEntry;
  /** The workspace to also switch the connection on in; null connects the account only. */
  workspaceId: string | null;
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
};

export function McpConnectDialog({
  provider,
  workspaceId,
  open,
  onOpenChangeAction,
}: McpConnectDialogProps) {
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const connectToken = useConnectWithToken();
  const startOAuth = useStartUserOAuth();

  const isOAuthProvider = provider.authType === "oauth";

  console.log("Workspace ID:", workspaceId);

  const handleOAuthConnect = async () => {
    try {
      const { authUrl } = await startOAuth.mutateAsync({
        provider: provider.name,
        workspaceId: workspaceId ?? undefined,
      });
      window.location.href = authUrl;
    } catch {
      toast.error(`Failed to start ${provider.displayName} authorization`);
    }
  };

  const handleConnect = async () => {
    const missing = provider.envKeys.filter((key) => !envValues[key]?.trim());
    if (missing.length > 0) {
      toast.error(`Please fill in: ${missing.join(", ")}`);
      return;
    }

    try {
      await connectToken.mutateAsync({
        provider: provider.name,
        workspaceId: workspaceId ?? undefined,
        env: envValues,
      });
      toast.success(`${provider.displayName} connected!`);
      onOpenChangeAction(false);
      setEnvValues({});
    } catch {
      toast.error(`Failed to connect ${provider.displayName}`);
    }
  };

  const formatEnvLabel = (key: string): string => {
    return key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace("Api ", "API ")
      .replace("Oauth ", "OAuth ");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {provider.displayName}</DialogTitle>
          <DialogDescription>{provider.description}</DialogDescription>
        </DialogHeader>

        {isOAuthProvider ? (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                This integration uses per-user OAuth. Client credentials are
                configured at platform level, so you only need to authorize your
                own account.
              </p>
              <Button
                className="w-full"
                onClick={handleOAuthConnect}
                disabled={startOAuth.isPending}
              >
                {startOAuth.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-2" />
                )}
                Authorize {provider.displayName}
              </Button>
            </div>
        ) : (
          <>
            <div className="space-y-4 py-4">
              {provider.envKeys.map((key) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-sm font-medium">{formatEnvLabel(key)}</label>
                  <Input
                    type="password"
                    placeholder={`Enter ${formatEnvLabel(key).toLowerCase()}`}
                    value={envValues[key] || ""}
                    onChange={(e) =>
                      setEnvValues((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                  />
                </div>
              ))}

              {provider.docsUrl && (
                <p className="text-xs text-muted-foreground">
                  Need help?{" "}
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    View documentation
                  </a>
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChangeAction(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleConnect} disabled={connectToken.isPending}>
                {connectToken.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Connect & Test
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
