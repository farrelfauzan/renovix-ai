"use client";

import { useAuthStore, useHydrated } from "@/lib/stores";
import { useProfilePhoto } from "@/hooks/use-profile-photo";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@performa-ai/ui/components/button";
import { Avatar, AvatarImage, AvatarFallback } from "@performa-ai/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@performa-ai/ui/components/dropdown-menu";
import { LogIn, LogOut, User, HelpCircle, CreditCard } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/lib/auth-client";

export function ChatHeader() {
  const { email, name, logout, isLoggedIn } = useAuthStore();
  const { data: photo } = useProfilePhoto();
  const queryClient = useQueryClient();
  const hydrated = useHydrated();

  const handleLogout = async () => {
    await signOut().catch(() => {});
    logout();
    queryClient.invalidateQueries({ queryKey: ["portal-usage"] });
    queryClient.invalidateQueries({ queryKey: ["portal-models"] });
  };

  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : email
      ? email[0].toUpperCase()
      : "?";

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-3" />

        <div className="flex items-center gap-2">
          {hydrated && isLoggedIn() ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 w-8 rounded-full p-0"
                >
                  <Avatar key={photo?.url ?? "none"} className="h-8 w-8">
                    {photo?.url && <AvatarImage src={photo.url} alt={name || email || ""} />}
                    <AvatarFallback className="text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    {name && (
                      <p className="text-sm font-medium leading-none">
                        {name}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      {email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings/general" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/billing" className="cursor-pointer">
                    <CreditCard className="mr-2 h-4 w-4" />
                    Top Up
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/help" className="cursor-pointer">
                    <HelpCircle className="mr-2 h-4 w-4" />
                    Help
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : hydrated ? (
            <Link href="/login">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg text-xs gap-1.5 hover:bg-secondary/60"
              >
                <LogIn className="h-3.5 w-3.5" /> Sign In
              </Button>
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
