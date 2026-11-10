"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Upload,
  Pencil,
  Users,
  Settings,
} from "lucide-react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@performa-ai/ui/components/tabs";
import {
  useChannelWorkspace,
  useCreateChannelWorkspace,
  useWorkspaceMembers,
} from "@/hooks/use-workspaces";
import {
  useChannel,
  useUpdateChannel,
  useUploadChannelIcon,
} from "@/hooks/use-channels";
import { ServerTeamSidebar } from "@/components/workspace/server-team-sidebar";
import { config } from "@/lib/config";

function isS3Icon(icon: string | null | undefined): boolean {
  if (!icon) return false;
  return (
    icon.includes("/") ||
    icon.endsWith(".png") ||
    icon.endsWith(".jpg") ||
    icon.endsWith(".jpeg") ||
    icon.endsWith(".webp") ||
    icon.endsWith(".gif")
  );
}

function getIconUrl(icon: string): string {
  if (icon.startsWith("http")) return icon;
  return `${config.cdnUrl}/${icon}`;
}

export function WorkspaceSettings({ channelId }: { channelId: string }) {
  const { data: channel, isLoading: channelLoading } = useChannel(channelId);
  const { data: wsData } = useChannelWorkspace(channelId);
  const { data: members } = useWorkspaceMembers(channelId);
  const updateChannel = useUpdateChannel();
  const uploadIcon = useUploadChannelIcon();

  const [editName, setEditName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (channelLoading || !channel) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleNameSave = () => {
    if (!editName || editName.trim() === "" || editName === channel.name) {
      setEditName(null);
      return;
    }
    updateChannel.mutate(
      { id: channelId, data: { name: editName.trim() } },
      {
        onSuccess: () => {
          toast.success("Server name updated");
          setEditName(null);
        },
        onError: () => toast.error("Failed to update name"),
      }
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      toast.error("Image must be less than 5MB");
      return;
    }

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Only PNG, JPEG, WebP, and GIF images are allowed");
      return;
    }

    uploadIcon.mutate(file, {
      onSuccess: (data) => {
        // Update the channel icon with the uploaded image
        updateChannel.mutate(
          { id: channelId, data: { icon: data.icon } },
          {
            onSuccess: () => toast.success("Server image updated"),
            onError: () => toast.error("Failed to update server image"),
          }
        );
      },
      onError: () => toast.error("Failed to upload image"),
    });

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveImage = () => {
    updateChannel.mutate(
      { id: channelId, data: { icon: "" } },
      {
        onSuccess: () => toast.success("Server image removed"),
        onError: () => toast.error("Failed to remove image"),
      }
    );
  };

  const currentIcon = channel.icon;
  const hasImage = isS3Icon(currentIcon);

  return (
    <Tabs defaultValue="general" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="general" className="gap-1.5">
          <Settings className="h-3.5 w-3.5" />
          General
        </TabsTrigger>
        <TabsTrigger value="team" className="gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Team
        </TabsTrigger>
      </TabsList>

      {/* General Tab */}
      <TabsContent value="general" className="space-y-6">
        {/* Server Image */}
        <section>
          <h3 className="text-sm font-medium mb-1">Server Image</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Upload a custom image for your server. This will be displayed in the
            server list.
          </p>

          <div className="flex items-center gap-5 border rounded-lg p-4">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-xl font-bold text-primary-foreground overflow-hidden shrink-0"
              style={{ backgroundColor: channel.color || "#6366f1" }}
            >
              {hasImage ? (
                <img
                  src={getIconUrl(currentIcon!)}
                  alt={channel.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>
                  {currentIcon || channel.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadIcon.isPending}
                >
                  {uploadIcon.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 mr-1" />
                  )}
                  {hasImage ? "Change Image" : "Upload Image"}
                </Button>
                {hasImage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={handleRemoveImage}
                    disabled={updateChannel.isPending}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Recommended: 256×256px or larger. Max 5MB. PNG, JPEG, WebP, or GIF.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleImageUpload}
            />
          </div>
        </section>

        {/* Server Name */}
        <section>
          <h3 className="text-sm font-medium mb-1">Server Name</h3>
          <p className="text-xs text-muted-foreground mb-3">
            The display name for this server.
          </p>
          {editName !== null ? (
            <div className="flex items-center gap-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="max-w-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNameSave();
                  if (e.key === "Escape") setEditName(null);
                }}
              />
              <Button
                size="sm"
                onClick={handleNameSave}
                disabled={updateChannel.isPending}
              >
                {updateChannel.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditName(null)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{channel.name}</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setEditName(channel.name)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </section>

        {/* Server Color */}
        <section>
          <h3 className="text-sm font-medium mb-1">Server Color</h3>
          <p className="text-xs text-muted-foreground mb-3">
            The accent color for this server icon.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={channel.color || "#6366f1"}
              onChange={(e) => {
                updateChannel.mutate(
                  { id: channelId, data: { color: e.target.value } },
                  {
                    onError: () => toast.error("Failed to update color"),
                  }
                );
              }}
              className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
            />
            <span className="text-xs text-muted-foreground">
              {channel.color || "#6366f1"}
            </span>
          </div>
        </section>

        {/* Workspace Info */}
        <section>
          <h3 className="text-sm font-medium mb-1">Workspace</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Workspace information for this server.
          </p>
          {wsData?.workspace ? (
            <div className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Name</span>
                <span className="text-sm">{wsData.workspace.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Status</span>
                <span className="text-sm capitalize">
                  {wsData.workspace.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Members</span>
                <span className="text-sm">{members?.length ?? "—"}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Workspace will be created automatically.
            </p>
          )}
        </section>
      </TabsContent>

      {/* Team Tab */}
      <TabsContent value="team" className="space-y-6">
        <section>
          <h3 className="text-sm font-medium mb-1">Team Members</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Manage team members who have access to this server.
          </p>
          <div className="border rounded-lg overflow-hidden">
            <ServerTeamSidebar
              channelId={channelId}
              isOwner={true}
              onClose={() => {}}
              embedded
            />
          </div>
        </section>
      </TabsContent>

    </Tabs>
  );
}
