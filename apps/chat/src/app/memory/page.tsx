"use client";

import {
  useMemories,
  useDeleteMemory,
  useUpdateMemory,
  useClearMemories,
} from "@/hooks/use-memory";
import { useAuthStore, useHydrated } from "@/lib/stores";
import Link from "next/link";
import {
  Brain,
  ArrowLeft,
  Trash2,
  Pin,
  Eraser,
  Lock,
} from "lucide-react";
import { Button } from "@performa-ai/ui/components/button";
import { AppSidebar } from "@/components/chat-sidebar";
import { SidebarProvider, SidebarInset } from "@performa-ai/ui/components/sidebar";

export default function MemoryPage() {
  const hydrated = useHydrated();
  const { isLoggedIn } = useAuthStore();
  const { data, isLoading } = useMemories();
  const deleteMutation = useDeleteMemory();
  const updateMutation = useUpdateMemory();
  const clearMutation = useClearMemories();

  const memories = data?.data ?? [];

  const memoryTypeLabel: Record<string, string> = {
    interest: "Interest",
    preference: "Preference",
    context: "Context",
    exclusion: "Exclusion",
  };

  if (!hydrated) return null;

  if (!isLoggedIn()) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8">
        <Lock className="h-12 w-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Memory</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Renovix AI will automatically remember your interests and preferences as
          you chat. Sign in to get started.
        </p>
        <Link href="/login">
          <Button className="mt-4">Sign In</Button>
        </Link>
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
          <div className="flex items-center gap-3 px-4 h-14">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <Brain className="h-5 w-5 text-primary" />
            <h1 className="font-semibold text-lg">Memory</h1>
          </div>
        </header>

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">
            Renovix AI automatically remembers your interests and preferences as
            you chat.
          </p>
          {memories.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="gap-2"
              onClick={() => clearMutation.mutate()}
            >
              <Eraser className="h-4 w-4" />
              Clear All
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-secondary/50 animate-pulse"
              />
            ))}
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">
              No memories yet. Start chatting and Renovix AI will remember what
              matters.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {memories.map((mem) => (
              <div
                key={mem.id}
                className="rounded-lg border border-border/50 bg-secondary/20 px-4 py-3 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {memoryTypeLabel[mem.type] || mem.type}
                      </span>
                      {mem.isUserPinned && (
                        <span className="text-[10px] text-primary font-medium">
                          Pinned
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground break-words">
                      {mem.content}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title={mem.isUserPinned ? "Unpin" : "Pin"}
                      onClick={() =>
                        updateMutation.mutate({
                          id: mem.id,
                          data: { isUserPinned: !mem.isUserPinned },
                        })
                      }
                    >
                      <Pin
                        className={`h-3.5 w-3.5 ${
                          mem.isUserPinned
                            ? "text-primary"
                            : "text-muted-foreground"
                        }`}
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Delete"
                      onClick={() => deleteMutation.mutate(mem.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
