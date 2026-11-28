"use client";

import { useResendInvite, useRevokeInvite } from "@/hooks/use-workspaces";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";
import { Badge } from "@performa-ai/ui/components/badge";
import { CircleX, Send, Mail } from "lucide-react";
import { toast } from "sonner";
import { isPackageLimitError } from "@/lib/is-package-limit-error";
import type { WorkspaceInvite } from "@/lib/workspace-types";
import { WorkspaceInviteDialog } from "./workspace-invite-dialog";

interface Props {
  workspaceId: string;
  invites: WorkspaceInvite[];
}

export function WorkspaceInvitesTab({ workspaceId, invites }: Props) {
  const resendInvite = useResendInvite();
  const revokeInvite = useRevokeInvite();

  const handleResend = (inviteId: string) => {
    resendInvite.mutate(
      { workspaceId, inviteId },
      {
        onSuccess: () => toast.success("Invite resent"),
        onError: (err) => {
          if (!isPackageLimitError(err)) toast.error("Failed to resend invite");
        },
      },
    );
  };

  const handleRevoke = (inviteId: string) => {
    revokeInvite.mutate(
      { workspaceId, inviteId },
      {
        onSuccess: () => toast.success("Invite revoked"),
        onError: () => toast.error("Failed to revoke invite"),
      },
    );
  };

  const pendingInvites = invites.filter((inv) => inv.status === "pending");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {pendingInvites.length} pending invite{pendingInvites.length !== 1 ? "s" : ""}
        </h3>
        <WorkspaceInviteDialog workspaceId={workspaceId} />
      </div>

      {pendingInvites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Mail className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No pending invites</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pendingInvites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted"
            >
              <div>
                <p className="text-sm font-medium">{invite.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-xs capitalize">
                    {invite.role}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Expires {new Date(invite.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconActionButton title="Resend" label={`Resend invite ${invite.email}`} icon={Send} isDisabled={resendInvite.isPending} onClick={() => handleResend(invite.id)} />
                <IconActionButton title="Revoke" tone="destructive" label={`Revoke invite ${invite.email}`} icon={CircleX} isDisabled={revokeInvite.isPending} onClick={() => handleRevoke(invite.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
