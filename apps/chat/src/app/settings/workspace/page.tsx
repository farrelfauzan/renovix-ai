"use client";

import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { useChannels } from "@/hooks/use-channels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function WorkspacePage() {
  const { data: channels, isLoading } = useChannels();
  const channel = channels?.[0];
  if (isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading workspace…</main>;
  if (!channel) return <main className="p-8 text-sm text-muted-foreground">Create an agent server to manage its workspace.</main>;
  return <main className="min-w-0 space-y-6 p-4 sm:p-8"><div><h1 className="text-xl font-semibold">Workspace and members</h1><p className="text-sm text-muted-foreground">Manage the selected agent server workspace.</p></div><Select value={channel.id}><SelectTrigger aria-label="Agent server" className="max-w-sm"><SelectValue placeholder={channel.name} /></SelectTrigger><SelectContent><SelectItem value={channel.id}>{channel.name}</SelectItem></SelectContent></Select><WorkspaceSettings channelId={channel.id} /></main>;
}
