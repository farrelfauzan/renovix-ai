"use client";

import { useState } from "react";
import { useRemoveMember, useUpdateMember } from "@/hooks/use-workspaces";
import { IconActionButton } from "@performa-ai/ui/components/icon-action-button";
import { Badge } from "@performa-ai/ui/components/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@performa-ai/ui/components/alert-dialog";
import { Shield, UserMinus } from "lucide-react";
import { toast } from "sonner";
import type { WorkspaceMember } from "@/lib/workspace-types";
import { WorkspaceInviteDialog } from "./workspace-invite-dialog";

interface Props {
  workspaceId: string;
  members: WorkspaceMember[];
}

export function WorkspaceMembersTab({ workspaceId, members }: Props) {
  const removeMember = useRemoveMember();
  const updateMember = useUpdateMember();
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMember | null>(null);

  const handleRemove = (memberId: string) => {
    removeMember.mutate(
      { workspaceId, memberId },
      {
        onSuccess: () => toast.success("Member removed"),
        onError: () => toast.error("Failed to remove member"),
      },
    );
  };

  const handleRoleChange = (memberId: string, role: string) => {
    updateMember.mutate(
      { workspaceId, memberId, data: { role } },
      {
        onSuccess: () => toast.success("Role updated"),
        onError: () => toast.error("Failed to update role"),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {members.length} member{members.length !== 1 ? "s" : ""}
        </h3>
        <WorkspaceInviteDialog workspaceId={workspaceId} />
      </div>

      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted"
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-rx-surface-2 flex items-center justify-center text-xs font-medium">
                {member.user.email.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium">{member.user.email}</p>
                <p className="text-xs text-muted-foreground">
                  Joined {new Date(member.joinedAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={member.role === "owner" ? "default" : "secondary"}
                className="text-xs capitalize"
              >
                {member.role === "owner" && (
                  <Shield className="h-3 w-3 mr-1" />
                )}
                {member.role}
              </Badge>

              {member.role !== "owner" && (
                <div className="flex items-center gap-1">
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.id, e.target.value)}
                    className="text-xs bg-rx-surface-2 border border-border rounded px-2 py-1 text-foreground"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>

                  <IconActionButton title="Remove" label={`Remove ${member.user.email}`} icon={UserMinus} onClick={() => setMemberToRemove(member)} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <AlertDialog open={memberToRemove !== null} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {memberToRemove?.user.email} from this workspace? They will lose access to shared agents and knowledge.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => memberToRemove && handleRemove(memberToRemove.id)}
              className="bg-destructive hover:bg-destructive/90 text-primary-foreground"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
