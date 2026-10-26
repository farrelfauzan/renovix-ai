"use client";

import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/chat-sidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuthStore, useHydrated } from "@/lib/stores";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const { isLoggedIn } = useAuthStore();
  const shellRoute = pathname === "/" || pathname === "/agents" || pathname.startsWith("/agents/") || pathname === "/settings" || pathname.startsWith("/settings/");
  if (!shellRoute) return <>{children}</>;

  const authenticated = hydrated && isLoggedIn();
  return (
    <SidebarProvider defaultOpen>
      {authenticated && <AppSidebar />}
      <SidebarInset className="min-w-0 h-svh overflow-hidden">
        {authenticated && (
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 md:hidden">
            <SidebarTrigger />
            <span className="text-sm font-medium">Renovix AI</span>
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
