"use client";

import {
  MessageSquare,
  Trash2,
  Bot,
  Settings,
  Sparkles,
  PanelLeft,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
  useSidebar,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useChatStore, useAuthStore, useHydrated } from "@/lib/stores";
import {
  useConversations,
  useDeleteConversation,
} from "@/hooks/use-conversations";
import { fetchConversation } from "@/lib/api";
import { toast } from "sonner";
import type { ConversationSummary } from "@/lib/api";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";

export function AppSidebar() {
  const hydrated = useHydrated();
  const { isLoggedIn } = useAuthStore();
  const loggedIn = hydrated && isLoggedIn();
  const { clearChat } = useChatStore();
  const { toggleSidebar, setOpenMobile } = useSidebar();
  const { email, name } = useAuthStore();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center justify-between px-2 py-1 group-data-[collapsible=icon]:group-data-[state=collapsed]:justify-center">
          {/* Collapsed: logo with hover-to-toggle */}
          <button
            onClick={toggleSidebar}
            className="items-center gap-2 group/logo relative hidden group-data-[collapsible=icon]:group-data-[state=collapsed]:flex"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-br from-indigo-500 to-purple-600 group-hover/logo:from-indigo-600 group-hover/logo:to-purple-700 transition-all">
              <Sparkles className="h-3.5 w-3.5 text-white group-hover/logo:hidden" />
              <PanelLeft className="h-3.5 w-3.5 text-white hidden group-hover/logo:block" />
            </div>
          </button>
          {/* Expanded: logo + toggle button */}
          <div className="flex items-center gap-2 group-data-[collapsible=icon]:group-data-[state=collapsed]:hidden">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-br from-indigo-500 to-purple-600">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold text-sm">Renovix AI</span>
          </div>
          <button
            onClick={toggleSidebar}
            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-sidebar-accent transition-colors group-data-[collapsible=icon]:group-data-[state=collapsed]:hidden"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>
        <div className="px-2 pb-2 group-data-[collapsible=icon]:group-data-[state=collapsed]:hidden">
          <p className="truncate text-sm font-medium">{name || email || "Your account"}</p>
          <p className="truncate text-xs text-sidebar-foreground/60">{email}</p>
          <WorkspaceSwitcher />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
              <SidebarMenuButton asChild className="gap-2 cursor-pointer">
            <Link href="/" onClick={() => { clearChat(); setOpenMobile(false); }}>
                <MessageSquare className="h-4 w-4" />
                <span>Chat</span>
            </Link>
              </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
              <SidebarMenuButton asChild className="gap-2 cursor-pointer">
            <Link href="/agents" onClick={() => setOpenMobile(false)}>
                <Bot className="h-4 w-4" />
                <span>Agents</span>
            </Link>
              </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
              <SidebarMenuButton asChild className="gap-2 cursor-pointer">
            <Link href="/settings" onClick={() => setOpenMobile(false)}>
                <Settings className="h-4 w-4" />
                <span>Settings</span>
            </Link>
              </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="group-data-[collapsible=icon]:group-data-[state=collapsed]:hidden">
        {!loggedIn ? (
          <div className="flex items-center justify-center h-full px-4">
            <p className="text-xs text-sidebar-foreground/60 text-center">
              Sign in and top up to access chat history and knowledge base.
            </p>
          </div>
        ) : (
          <ChatsContent />
        )}
      </SidebarContent>
      <div className="border-t border-sidebar-border p-3 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:group-data-[state=collapsed]:hidden">
        <div className="mb-1 flex items-center justify-between"><span>Credits</span><span>SLOT</span></div>
        <div className="h-1.5 rounded-full bg-sidebar-accent" aria-label="Credit balance unavailable" />
      </div>
    </Sidebar>
  );
}

// ─── Chats Content ───

function ChatsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading } = useConversations(50, 0);
  const deleteMutation = useDeleteConversation();
  const {
    loadConversation,
    clearChat,
    conversationId,
    isStreaming,
    streamingConversationId,
    setConversationId,
  } = useChatStore();

  const handleDeleteConversation = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Conversation deleted");
      if (conversationId === id) {
        clearChat();
      }
    } catch {
      toast.error("Failed to delete conversation");
    }
  };

  const handleLoadConversation = async (conv: ConversationSummary) => {
    if (isStreaming && streamingConversationId === conv.id) {
      setConversationId(conv.id);
      if (pathname !== "/") {
        router.push("/");
      }
      return;
    }

    try {
      const detail = await fetchConversation(conv.id);
      loadConversation(
        detail.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.document ? { document: m.document } : {}),
        })),
        detail.id,
      );
      if (pathname !== "/") {
        router.push("/");
      }
    } catch {
      // silently fail
    }
  };

  const grouped = groupByDate(data?.data ?? []);

  return (
    <>
      {isLoading ? (
        <SidebarGroup>
          <SidebarMenu>
            {[...Array(5)].map((_, i) => (
              <SidebarMenuItem key={i}>
                <div className="h-8 rounded-md bg-sidebar-accent/50 animate-pulse" />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ) : (data?.data?.length ?? 0) === 0 ? (
        <SidebarGroup>
          <div className="flex items-center justify-center py-8">
            <p className="text-xs text-sidebar-foreground/60">
              No conversations yet
            </p>
          </div>
        </SidebarGroup>
      ) : (
        grouped.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.conversations.map((conv) => (
                  <SidebarMenuItem key={conv.id}>
                    <SidebarMenuButton
                      isActive={conversationId === conv.id}
                      onClick={() => handleLoadConversation(conv)}
                      tooltip={conv.title || "Untitled"}
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span>{conv.title || "Untitled"}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteConversation(conv.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))
      )}
    </>
  );
}

// ─── Helpers ───

function groupByDate(conversations: ConversationSummary[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const last7 = new Date(today.getTime() - 7 * 86400000);

  const groups: { label: string; conversations: ConversationSummary[] }[] = [
    { label: "Today", conversations: [] },
    { label: "Yesterday", conversations: [] },
    { label: "Last 7 days", conversations: [] },
    { label: "Older", conversations: [] },
  ];

  for (const conv of conversations) {
    const date = new Date(conv.updatedAt);
    if (date >= today) {
      groups[0].conversations.push(conv);
    } else if (date >= yesterday) {
      groups[1].conversations.push(conv);
    } else if (date >= last7) {
      groups[2].conversations.push(conv);
    } else {
      groups[3].conversations.push(conv);
    }
  }

  return groups.filter((g) => g.conversations.length > 0);
}
