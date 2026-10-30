"use client";

import { useState } from "react";
import {
  Users,
  Mail,
  Crown,
  Shield,
  UserPlus,
  X,
  RotateCw,
  Loader2,
  BookOpen,
  Plus,
  Trash2,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useChannelWorkspace,
  useWorkspaceMembers,
  useWorkspaceInvites,
  useWorkspaceQuota,
  useCreateChannelWorkspace,
  useInviteMember,
  useResendInvite,
  useRevokeInvite,
  useUpdateMember,
  useRemoveMember,
} from "@/hooks/use-workspaces";
import { toast } from "sonner";
import { isPackageLimitError } from "@/lib/is-package-limit-error";
import {
  useWorkspaceKnowledgeBases,
  useDeleteWorkspaceKB,
} from "@/hooks/use-workspace-knowledge";
import { WorkspaceKnowledgeDialog } from "./workspace-knowledge-dialog";

interface ServerTeamSidebarProps {
  channelId: string;
  isOwner: boolean;
  onClose: () => void;
  embedded?: boolean;
}

export function ServerTeamSidebar({ channelId, isOwner, onClose, embedded }: ServerTeamSidebarProps) {
  const { data: wsData, isLoading } = useChannelWorkspace(channelId);
  const createWorkspace = useCreateChannelWorkspace();

  if (isLoading) {
    if (embedded) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      );
    }
    return (
      <SidebarShell onClose={onClose}>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      </SidebarShell>
    );
  }

  if (!wsData?.exists) {
    if (embedded) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
          <Users className="w-10 h-10 text-zinc-600" />
          <p className="text-sm text-zinc-400">Team workspace not enabled</p>
          {isOwner && (
            <Button
              size="sm"
              onClick={() =>
                createWorkspace.mutate(channelId, {
                  onSuccess: () => toast.success("Team workspace enabled!"),
                  onError: () => toast.error("Failed to enable workspace"),
                })
              }
              disabled={createWorkspace.isPending}
            >
              {createWorkspace.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Enable Team
            </Button>
          )}
        </div>
      );
    }
    return (
      <SidebarShell onClose={onClose}>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
          <Users className="w-10 h-10 text-zinc-600" />
          <p className="text-sm text-zinc-400">Team workspace not enabled</p>
          {isOwner && (
            <Button
              size="sm"
              onClick={() =>
                createWorkspace.mutate(channelId, {
                  onSuccess: () => toast.success("Team workspace enabled!"),
                  onError: () => toast.error("Failed to enable workspace"),
                })
              }
              disabled={createWorkspace.isPending}
            >
              {createWorkspace.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Enable Team
            </Button>
          )}
        </div>
      </SidebarShell>
    );
  }

  if (embedded) {
    return <TeamContent channelId={channelId} isOwner={isOwner} />;
  }

  return (
    <SidebarShell onClose={onClose}>
      <TeamContent channelId={channelId} isOwner={isOwner} />
    </SidebarShell>
  );
}

function SidebarShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="w-[260px] shrink-0 bg-zinc-900/80 border-l border-zinc-800 flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-200">Team</h4>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

function TeamContent({ channelId, isOwner }: { channelId: string; isOwner: boolean }) {
  const { data: members } = useWorkspaceMembers(channelId);
  const { data: invites } = useWorkspaceInvites(channelId);
  const { data: quota } = useWorkspaceQuota(channelId);
  const [showInviteForm, setShowInviteForm] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Quota bar */}
      {quota && (
        <div className="px-3 py-2 border-b border-zinc-800">
          <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
            <span>Members</span>
            <span>{quota.used}/{quota.limit}</span>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full">
            <div
              className="h-1 bg-indigo-500 rounded-full transition-all"
              style={{ width: `${Math.min((quota.used / quota.limit) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Members */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
            Members — {members?.length ?? 0}
          </span>
          {isOwner && (
            <button
              onClick={() => setShowInviteForm(!showInviteForm)}
              className="text-zinc-500 hover:text-indigo-400"
              title="Invite member"
            >
              <UserPlus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {showInviteForm && <InviteForm channelId={channelId} onDone={() => setShowInviteForm(false)} />}

        <div className="space-y-1">
          {members?.map((member) => (
            <MemberRow key={member.id} member={member} isOwner={isOwner} channelId={channelId} />
          ))}
        </div>
      </div>

      {/* Pending Invites */}
      {isOwner && invites && invites.filter((i) => i.status === "pending").length > 0 && (
        <div className="px-3 py-2 border-t border-zinc-800">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider block mb-2">
            Pending Invites
          </span>
          <div className="space-y-1">
            {invites
              .filter((i) => i.status === "pending")
              .map((invite) => (
                <InviteRow key={invite.id} invite={invite} channelId={channelId} />
              ))}
          </div>
        </div>
      )}

      {/* Shared Knowledge */}
      <KnowledgeSection channelId={channelId} isOwner={isOwner} />
    </div>
  );
}

function InviteForm({ channelId, onDone }: { channelId: string; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const inviteMember = useInviteMember();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    inviteMember.mutate(
      { channelId, data: { email: email.trim(), role } },
      {
        onSuccess: () => {
          toast.success(`Invite sent to ${email}`);
          setEmail("");
          onDone();
        },
        onError: (err: any) => {
          if (!isPackageLimitError(err)) toast.error(err?.response?.data?.message || "Failed to send invite");
        },
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="mb-3 space-y-2">
      <Input
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-7 text-xs bg-zinc-800 border-zinc-700"
        type="email"
        required
      />
      <div className="flex gap-1">
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-7 text-xs flex-1 bg-zinc-800 border-zinc-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={inviteMember.isPending}>
          {inviteMember.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Send"}
        </Button>
      </div>
    </form>
  );
}

function MemberRow({
  member,
  isOwner,
  channelId,
}: {
  member: any;
  isOwner: boolean;
  channelId: string;
}) {
  const removeMember = useRemoveMember();
  const updateMember = useUpdateMember();

  const roleIcon =
    member.role === "owner" ? (
      <Crown className="w-3 h-3 text-amber-400" />
    ) : member.role === "admin" ? (
      <Shield className="w-3 h-3 text-indigo-400" />
    ) : null;

  return (
    <div className="flex items-center gap-2 px-1 py-1 rounded hover:bg-zinc-800/50 group">
      <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-300">
        {member.user.email.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-zinc-300 truncate block">{member.user.email}</span>
      </div>
      {roleIcon}
      {isOwner && member.role !== "owner" && (
        <button
          onClick={() =>
            removeMember.mutate(
              { channelId, memberId: member.id },
              { onSuccess: () => toast.success("Member removed") },
            )
          }
          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400"
          title="Remove"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function InviteRow({ invite, channelId }: { invite: any; channelId: string }) {
  const resend = useResendInvite();
  const revoke = useRevokeInvite();

  return (
    <div className="flex items-center gap-2 px-1 py-1 rounded hover:bg-zinc-800/50 group">
      <Mail className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs text-zinc-400 truncate block">{invite.email}</span>
      </div>
      <button
        onClick={() =>
          resend.mutate(
            { channelId, inviteId: invite.id },
            { onSuccess: () => toast.success("Invite resent") },
          )
        }
        className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-indigo-400"
        title="Resend"
      >
        <RotateCw className="w-3 h-3" />
      </button>
      <button
        onClick={() =>
          revoke.mutate(
            { channelId, inviteId: invite.id },
            { onSuccess: () => toast.success("Invite revoked") },
          )
        }
        className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400"
        title="Revoke"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Knowledge Section ────────────────────────────────────────────────────────

function KnowledgeSection({ channelId, isOwner }: { channelId: string; isOwner: boolean }) {
  const { data: knowledgeBases } = useWorkspaceKnowledgeBases(channelId);
  const deleteKB = useDeleteWorkspaceKB();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetKb, setTargetKb] = useState<{ id: string; name: string } | null>(null);

  const openCreateDialog = () => {
    setTargetKb(null);
    setDialogOpen(true);
  };

  const openAddContentDialog = (kb: { id: string; name: string }) => {
    setTargetKb(kb);
    setDialogOpen(true);
  };

  return (
    <div className="px-3 py-2 border-t border-zinc-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
          Shared Knowledge
        </span>
        {isOwner && (
          <button
            onClick={openCreateDialog}
            className="text-zinc-500 hover:text-indigo-400"
            title="Add knowledge base"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {(!knowledgeBases || knowledgeBases.length === 0) && (
        <p className="text-xs text-zinc-600 mb-1">No shared knowledge yet</p>
      )}

      <div className="space-y-1">
        {knowledgeBases?.map((kb) => (
          <div key={kb.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-zinc-800/50 group">
            <BookOpen className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-zinc-300 truncate block">{kb.name}</span>
              <span className="text-[10px] text-zinc-600">{kb._count.chunks} chunks</span>
            </div>
            <button
              onClick={() => openAddContentDialog({ id: kb.id, name: kb.name })}
              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-emerald-400"
              title="Add knowledge"
            >
              <FileText className="w-3 h-3" />
            </button>
            {isOwner && (
              <button
                onClick={() =>
                  deleteKB.mutate(
                    { channelId, kbId: kb.id },
                    { onSuccess: () => toast.success("Knowledge base deleted") },
                  )
                }
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      <WorkspaceKnowledgeDialog
        channelId={channelId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        targetKbId={targetKb?.id}
        targetKbName={targetKb?.name}
      />
    </div>
  );
}
