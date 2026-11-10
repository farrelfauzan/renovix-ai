"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@performa-ai/ui/components/tooltip";
import { Toaster } from "@performa-ai/ui/components/sonner";
import { useState, type ReactNode } from "react";
import { AuthHydrator } from "@/components/auth-hydrator";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthHydrator />
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
