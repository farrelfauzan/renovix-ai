"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useResolveInvite, useAcceptInvite } from "@/hooks/use-workspaces";
import { useAuthStore, useHydrated } from "@/lib/stores";
import { Button } from "@performa-ai/ui/components/button";
import { Badge } from "@performa-ai/ui/components/badge";
import {
  Loader2,
  Building2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

export default function AcceptInviteClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hydrated = useHydrated();
  const { isLoggedIn } = useAuthStore();
  const token = searchParams.get("token");

  const { data: invite, isLoading, error } = useResolveInvite(token);
  const acceptInvite = useAcceptInvite();

  const handleAccept = () => {
    if (!token) return;
    acceptInvite.mutate(token, {
      onSuccess: (result) => {
        toast.success("Welcome to the workspace!");
        if (result.channelId) {
          router.push(`/agents?server=${result.channelId}`);
        } else {
          router.push("/agents");
        }
      },
      onError: () => {
        toast.error("Failed to accept invite");
      },
    });
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-sm">
          <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h1 className="text-lg font-semibold mb-2">Invalid Link</h1>
          <p className="text-sm text-muted-foreground">
            This invitation link is missing a token. Please check the link from your email.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-sm">
          <AlertTriangle className="h-12 w-12 text-rx-amber-text mx-auto mb-4" />
          <h1 className="text-lg font-semibold mb-2">Invite Not Found</h1>
          <p className="text-sm text-muted-foreground mb-4">
            This invitation may have expired or been revoked. Ask your workspace admin for a new invite.
          </p>
          <Link href="/">
            <Button variant="outline">Go Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (invite.status !== "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-sm">
          <CheckCircle2 className="h-12 w-12 text-rx-green mx-auto mb-4" />
          <h1 className="text-lg font-semibold mb-2">Already Accepted</h1>
          <p className="text-sm text-muted-foreground mb-4">
            This invitation has already been used.
          </p>
          <Link href="/agents/workspace">
            <Button>Go to Workspaces</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!isLoggedIn()) {
    const redirectUrl = `/workspace-invites/accept?token=${encodeURIComponent(token)}`;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm w-full">
          <div className="text-center mb-6">
            <Building2 className="h-12 w-12 text-primary mx-auto mb-4" />
            <h1 className="text-lg font-semibold mb-1">
              Join {invite.workspaceName}
            </h1>
            <p className="text-sm text-muted-foreground">
              You&apos;ve been invited as a{" "}
              <Badge variant="secondary" className="text-xs capitalize">
                {invite.role}
              </Badge>
            </p>
          </div>

          <div className="rounded-lg border border-border p-4 mb-6">
            <p className="text-sm text-muted-foreground text-center">
              Sign in with <strong>{invite.email}</strong> to accept this invitation.
            </p>
          </div>

          <Link href={`/login?redirect=${encodeURIComponent(redirectUrl)}`}>
            <Button className="w-full">Sign In to Accept</Button>
          </Link>
          <Link href={`/register?redirect=${encodeURIComponent(redirectUrl)}`}>
            <Button variant="outline" className="w-full mt-2">
              Create Account
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Logged in — show accept CTA
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-sm w-full text-center">
        <Building2 className="h-12 w-12 text-primary mx-auto mb-4" />
        <h1 className="text-lg font-semibold mb-1">
          Join {invite.workspaceName}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          You&apos;ve been invited as a{" "}
          <Badge variant="secondary" className="text-xs capitalize">
            {invite.role}
          </Badge>
        </p>

        <div className="rounded-lg border border-border p-4 mb-6 text-left text-sm">
          <div className="flex justify-between mb-2">
            <span className="text-muted-foreground">Workspace</span>
            <span className="font-medium">{invite.workspaceName}</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium capitalize">{invite.role}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Expires</span>
            <span className="font-medium">
              {new Date(invite.expiresAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <Button
          className="w-full"
          onClick={handleAccept}
          disabled={acceptInvite.isPending}
        >
          {acceptInvite.isPending && (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          )}
          Join Workspace
        </Button>
      </div>
    </div>
  );
}
