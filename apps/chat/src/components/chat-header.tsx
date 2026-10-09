"use client";

import { usePortalUsage } from "@/hooks/use-portal";
import { useAuthStore, useHydrated } from "@/lib/stores";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LogIn, LogOut, User, HelpCircle, CreditCard } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/lib/auth-client";
import { apiClient } from "@/lib/api-client";

export function ChatHeader() {
  const { data: usage } = usePortalUsage();
  const { email, name, avatar, sessionAuth, logout, isLoggedIn } =
    useAuthStore();
  const queryClient = useQueryClient();
  const hydrated = useHydrated();
  const isPaid = usage?.tier === "paid";

  const handleLogout = async () => {
    if (sessionAuth) {
      await signOut().catch(() => {});
    } else {
      // Clears the API's httpOnly jwt cookie (RX-68)
      await apiClient.post("/auth/logout").catch(() => {});
    }
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
          {/* Usage pill - free tier */}
          {usage && !isPaid && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 rounded-full bg-secondary/50 px-3 py-1 text-[11px] text-muted-foreground cursor-default">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>{usage.remaining ?? 0} left</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">
                  Free tier daily requests remaining. Sign in and top up for
                  unlimited access.
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Usage pill - paid tier */}
          {usage && isPaid && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 rounded-full bg-secondary/50 px-3 py-1 text-[11px] text-muted-foreground cursor-default">
                  <div className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  <span>${Number(usage.balance ?? 0).toFixed(2)}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">
                  Your credit balance. Used for pay-per-request AI model access.
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {hydrated && isLoggedIn() ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 w-8 rounded-full p-0"
                >
                  <Avatar className="h-8 w-8">
                    {avatar && <AvatarImage src={avatar} alt={name || email || ""} />}
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
                  <Link href="/profile" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/top-up" className="cursor-pointer">
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
