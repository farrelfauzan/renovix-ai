"use client";

import { useRef, useState } from "react";
import type { FormApi } from "@tanstack/react-form";
import { useUploadAgentAvatar } from "@/hooks/use-agents";
import { config } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload,
  Smile,
  Image as ImageIcon,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

export interface AgentFormValues {
  name: string;
  description: string;
  avatar: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number | undefined;
  isPublic: boolean;
  agentType: "standalone" | "parent" | "sub_agent";
  parentAgentId: string;
  tools: string[];
}

interface IdentityStepProps {
  form: FormApi<AgentFormValues, any>;
}

export function IdentityStep({ form }: IdentityStepProps) {
  const uploadAvatar = useUploadAgentAvatar();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(() => {
    const avatar = form.getFieldValue("avatar");
    return avatar && avatar.startsWith("http") ? avatar : null;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Invalid file type. Use JPEG, PNG, GIF, or WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large. Max 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    uploadAvatar.mutate(file, {
      onSuccess: (data) => {
        const avatarUrl = data.icon.startsWith("http")
          ? data.icon
          : `${config.cdnUrl}/${data.icon}`;
        form.setFieldValue("avatar", avatarUrl);
        toast.success("Avatar uploaded!");
      },
      onError: () => {
        setImagePreview(null);
        toast.error("Failed to upload avatar");
      },
    });
  };

  const handleEmojiSelect = (emoji: any) => {
    form.setFieldValue("avatar", emoji.native);
    setShowEmojiPicker(false);
    setImagePreview(null);
  };

  const clearImage = () => {
    setImagePreview(null);
    form.setFieldValue("avatar", "");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-5">
      {/* Name */}
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Agent Name *</label>
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="e.g. Sprint Planner, Meeting Scheduler"
              maxLength={100}
            />
          </div>
        )}
      </form.Field>

      {/* Description */}
      <form.Field name="description">
        {(field) => (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="What does this agent do?"
              rows={3}
              maxLength={500}
            />
          </div>
        )}
      </form.Field>

      {/* Avatar */}
      <form.Field name="avatar">
        {(field) => (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Avatar</label>
            <div className="flex items-center gap-4">
              {/* Preview */}
              <div className="relative group">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-lg font-bold text-white overflow-hidden cursor-pointer border-2 border-muted hover:border-muted-foreground/50 transition-colors bg-primary/10"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Agent avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : field.state.value &&
                    !field.state.value.startsWith("http") ? (
                    <span className="text-2xl">{field.state.value}</span>
                  ) : (
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>
                {imagePreview && (
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={clearImage}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
                {uploadAvatar.isPending && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl">
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  >
                    <Smile className="w-3.5 h-3.5 mr-1.5" />
                    Emoji
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Upload an image or pick an emoji
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleImageUpload}
              />
            </div>

            {/* Emoji Picker */}
            {showEmojiPicker && (
              <>
                <div
                  className="fixed inset-0 z-100"
                  onClick={() => setShowEmojiPicker(false)}
                />
                <div className="fixed z-101 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                  <Picker
                    data={data}
                    onEmojiSelect={handleEmojiSelect}
                    theme="dark"
                    previewPosition="none"
                    skinTonePosition="search"
                    maxFrequentRows={1}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </form.Field>

      {/* Public */}
      <form.Field name="isPublic">
        {(field) => (
          <div className="flex items-center gap-2">
            <Checkbox
              id="isPublic"
              checked={field.state.value}
              onCheckedChange={(checked) =>
                field.handleChange(checked === true)
              }
            />
            <label htmlFor="isPublic" className="text-sm cursor-pointer">
              Make this agent public (visible in explore)
            </label>
          </div>
        )}
      </form.Field>
    </div>
  );
}
