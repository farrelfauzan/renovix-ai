"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@performa-ai/ui/components/tooltip";
import { Toaster } from "@performa-ai/ui/components/sonner";
import { useState, type CSSProperties, type ReactNode } from "react";
import { AuthHydrator } from "@/components/auth-hydrator";

/** Sonner reads its own colour variables, so the primitive's token classes alone lose to it. */
const TOAST_STYLE = {
  "--normal-bg": "var(--background)",
  "--normal-text": "var(--foreground)",
  "--normal-border": "var(--border)",
} as CSSProperties;

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
        <Toaster theme="light" style={TOAST_STYLE} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
