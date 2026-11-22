"use client";

import { useRef, useState } from "react";
import { isAxiosError } from "axios";
import { Avatar, AvatarFallback, AvatarImage } from "@performa-ai/ui/components/avatar";
import { Button } from "@performa-ai/ui/components/button";
import type { CurrentUser } from "@/hooks/use-current-user";
import { useProfilePhoto } from "@/hooks/use-profile-photo";
import { useRemoveProfilePhoto } from "@/hooks/use-remove-profile-photo";
import { useUploadProfilePhoto } from "@/hooks/use-upload-profile-photo";
import { PROFILE_PHOTO_LIMITS } from "@/lib/profile-photo-limits";

const ACCEPTED_TYPES = PROFILE_PHOTO_LIMITS.mimeTypes.join(",");

/**
 * RNX-334: the photo of the Profile section: the signed-in user's own photo (or their initials), with Upload or
 * Replace and Remove. The type and size are checked here only to answer before sending; the API decides. Loading,
 * upload and removal failures are shown in place.
 */
export function ProfilePhotoField({ user }: { user: CurrentUser }) {
  const photo = useProfilePhoto();
  const upload = useUploadProfilePhoto();
  const remove = useRemoveProfilePhoto();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const url = photo.data?.url ?? null;
  const isBusy = upload.isPending || remove.isPending;
  const displayName = user.name || user.email;
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(PROFILE_PHOTO_LIMITS.mimeTypes as readonly string[]).includes(file.type)) {
      setMessage("Use a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > PROFILE_PHOTO_LIMITS.maxBytes) {
      setMessage(`The photo must be ${PROFILE_PHOTO_LIMITS.maxLabel} or smaller.`);
      return;
    }
    setMessage(null);
    upload.mutate(file, {
      onError: (error) =>
        setMessage((isAxiosError(error) && error.response?.data?.error?.details?.file?.[0]) || "Could not upload the photo. Try again."),
    });
  };

  const handleRemove = () => {
    setMessage(null);
    remove.mutate(undefined, { onError: () => setMessage("Could not remove the photo. Try again.") });
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Keyed by the URL: Radix keeps "image loaded" after the image is removed, which would hide the initials. */}
      <Avatar key={url ?? "none"} className="size-16">
        {url && <AvatarImage src={url} alt={displayName} />}
        <AvatarFallback className="text-lg">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium">Photo</span>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" aria-label="Choose a photo" onChange={handleFileChosen} />
          <Button type="button" variant="outline" size="sm" disabled={isBusy || photo.isPending} onClick={() => inputRef.current?.click()}>
            {upload.isPending ? "Uploading..." : url ? "Replace" : "Upload"}
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm" disabled={isBusy} onClick={handleRemove}>
              {remove.isPending ? "Removing..." : "Remove"}
            </Button>
          )}
        </div>
        {photo.isPending && (
          <span role="status" className="text-xs text-muted-foreground">
            Loading photo...
          </span>
        )}
        {photo.isError && (
          <span role="alert" className="text-xs text-destructive">
            Could not load your photo.{" "}
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => photo.refetch()}>
              Try again
            </Button>
          </span>
        )}
        {message && (
          <span role="alert" className="text-xs text-destructive">
            {message}
          </span>
        )}
        <span className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to {PROFILE_PHOTO_LIMITS.maxLabel}.</span>
      </div>
    </div>
  );
}
