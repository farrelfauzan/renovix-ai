"use client";

import { useState } from "react";
import { useInviteMember } from "@/hooks/use-workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isPackageLimitError } from "@/lib/is-package-limit-error";

interface Props {
  workspaceId: string;
}

export function WorkspaceInviteDialog({ workspaceId }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const inviteMember = useInviteMember();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    inviteMember.mutate(
      { workspaceId, data: { email: email.trim().toLowerCase(), role } },
      {
        onSuccess: () => {
          toast.success(`Invite sent to ${email}`);
          setEmail("");
          setRole("member");
          setOpen(false);
        },
        onError: (err) => {
          if (!isPackageLimitError(err)) toast.error("Failed to send invite");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <UserPlus className="h-4 w-4" />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email address</label>
            <Input
              type="email"
              placeholder="colleague@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm"
            >
              <option value="member">Member — can use shared agents & knowledge</option>
              <option value="admin">Admin — can invite members & manage workspace</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!email.trim() || inviteMember.isPending}>
              {inviteMember.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Send Invite
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
