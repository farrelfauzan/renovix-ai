"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useChannels,
  useChannel,
  useDeleteChannel,
  useAddChannelAgent,
  useRemoveChannelAgent,
  useChannelMessages,
  useClearMessages,
} from "@/hooks/use-channels";
import { useChannelChat } from "@/hooks/use-channel-chat";
import { useAgents, useAgentSubscription } from "@/hooks/use-agents";
import { useAuthStore, useHydrated } from "@/lib/stores";
import Link from "next/link";
import {
  Bot,
  MessageSquare,
  Trash2,
  Loader2,
  Lock,
  Zap,
  ArrowLeft,
  ArrowDown,
  Send,
  StopCircle,
  Hash,
  Brain,
  Wrench,
  Sparkles,
  User,
  Server,
  UserPlus,
  X,
  Compass,
  Users,
  Settings,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import { CodeBlock } from "@/components/code-block";
import { DocumentCard } from "@/components/document-card";
import { CreateServerDialog } from "@/components/agents/create-server-dialog";
import { ServerTeamSidebar } from "@/components/workspace/server-team-sidebar";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { AgentSettingsPanel } from "@/components/settings/agent-settings-panel";
import { config } from "@/lib/config";
import { apiClient } from "@/lib/api-client";

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

export default function AgentsPageClient() {
  const hydrated = useHydrated();
  const { isLoggedIn } = useAuthStore();
  const { data: channels, isLoading: channelsLoading } = useChannels();
  const { data: subscriptionData, isLoading: subLoading } =
    useAgentSubscription();
  const searchParams = useSearchParams();
  const router = useRouter();

  const selectedServerId = searchParams.get("server");
  const selectedAgentId = searchParams.get("agent");
  const currentView = searchParams.get("view"); // "settings" or null
  const effectiveSettingsServerId =
    selectedServerId || channels?.[0]?.id || null;
  const [showTeamSidebar, setShowTeamSidebar] = useState(false);

  const setSelectedServerId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) {
        params.set("server", id);
      } else {
        params.delete("server");
      }
      params.delete("agent");
      params.delete("view");
      router.replace(`/agents?${params.toString()}`);
    },
    [searchParams, router],
  );

  const setSelectedAgentId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) {
        params.set("agent", id);
      } else {
        params.delete("agent");
      }
      params.delete("view");
      router.replace(`/agents?${params.toString()}`);
    },
    [searchParams, router],
  );

  const setView = useCallback(
    (view: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (view) {
        params.set("view", view);
        params.delete("agent");
      } else {
        params.delete("view");
      }
      router.replace(`/agents?${params.toString()}`);
    },
    [searchParams, router],
  );

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isLoggedIn()) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-8">
        <Lock className="h-12 w-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">AI Agents</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Create servers with AI agents that automate your workflow. Sign in to
          get started.
        </p>
        <Link href="/login">
          <Button className="mt-4">Sign In</Button>
        </Link>
      </div>
    );
  }

  const subscription = subscriptionData?.subscription;

  if (subLoading || channelsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!subscription) {
    return <SubscriptionPricing />;
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Left: Servers (projects) */}
      <div className="w-18 shrink-0 bg-zinc-900 flex flex-col items-center py-3 gap-2 border-r border-zinc-800 overflow-y-auto">
        <Link href="/">
          <button
            className="w-12 h-12 rounded-2xl flex items-center justify-center bg-zinc-700 text-zinc-300 hover:bg-indigo-600 hover:text-white hover:rounded-xl transition-all mb-2"
            title="Back to Chat"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            if (currentView === "agent-settings") {
              params.delete("view");
            } else {
              params.set("view", "agent-settings");
            }
            params.delete("server");
            params.delete("agent");
            router.replace(`/agents?${params.toString()}`);
          }}
          className={`w-12 h-12 rounded-2xl transition-all hover:rounded-xl mb-2 ${
            currentView === "agent-settings"
              ? "bg-indigo-600 text-white rounded-xl ring-2 ring-white/20 hover:bg-indigo-700"
              : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600 hover:text-white"
          }`}
          title="Agent Settings"
        >
          <Settings2 className="w-5 h-5" />
        </Button>

        <div className="w-8 h-px bg-zinc-700 mb-1" />

        {channelsLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500 mt-4" />
        ) : (
          channels?.map((channel) => (
            <button
              key={channel.id}
              onClick={() => {
                setSelectedServerId(channel.id);
              }}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold transition-all hover:rounded-xl ${
                selectedServerId === channel.id
                  ? "rounded-xl text-white ring-2 ring-white/20"
                  : "text-zinc-300 hover:brightness-110"
              }`}
              style={{
                backgroundColor:
                  selectedServerId === channel.id
                    ? channel.color || "#6366f1"
                    : channel.color || "#3f3f46",
              }}
              title={channel.name}
            >
              {isS3Icon(channel.icon) ? (
                <img
                  src={getIconUrl(channel.icon!)}
                  alt={channel.name}
                  className="w-full h-full object-cover rounded-2xl"
                />
              ) : (
                channel.icon || channel.name.charAt(0).toUpperCase()
              )}
            </button>
          ))
        )}

        <CreateServerButton />
      </div>

      {/* Middle: Agent Channels in selected server */}
      {currentView !== "agent-settings" && (
        <div className="w-60 shrink-0 bg-zinc-900/50 border-r border-zinc-800 flex flex-col">
          {selectedServerId ? (
            <ServerMiddlePanel
              serverId={selectedServerId}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
              onDeleteServer={() => {
                setSelectedServerId(null);
              }}
              onToggleTeam={() => setShowTeamSidebar((v) => !v)}
              showTeamSidebar={showTeamSidebar}
              currentView={currentView}
              onSetView={setView}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-sm px-4 text-center gap-3">
              <Server className="w-10 h-10 text-zinc-600" />
              <p>Select a server or create one</p>
              <p className="text-xs text-zinc-600">
                Servers are projects with AI agents
              </p>
            </div>
          )}
        </div>
      )}

      {/* Right: Chat with selected agent OR Server Settings OR Agent Settings */}
      <div className="flex-1 flex flex-col min-w-0">
        {currentView === "agent-settings" ? (
          <AgentSettingsPanel channelId={effectiveSettingsServerId} />
        ) : selectedServerId && currentView === "settings" ? (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto p-6">
              <div className="flex items-center gap-3 mb-6">
                <Settings className="h-5 w-5 text-zinc-400" />
                <div>
                  <h2 className="text-lg font-semibold text-zinc-100">
                    Server Settings
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Manage your server settings, image, team, and integrations
                  </p>
                </div>
              </div>
              <WorkspaceSettings channelId={selectedServerId} />
            </div>
          </div>
        ) : selectedServerId && selectedAgentId ? (
          <ChannelChatPanel
            channelId={selectedServerId}
            agentId={selectedAgentId}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 text-zinc-600" />
              <p className="text-sm">
                {selectedServerId
                  ? "Select an agent channel to start chatting"
                  : "Select a server to see its agents"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Far Right: Team Sidebar */}
      {showTeamSidebar && selectedServerId && (
        <ServerTeamSidebar
          channelId={selectedServerId}
          isOwner={true}
          onClose={() => setShowTeamSidebar(false)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Create Server Button
// ═══════════════════════════════════════════════════════════

function CreateServerButton() {
  return <CreateServerDialog />;
}

// ═══════════════════════════════════════════════════════════
// Middle Panel: Server info + agent channels
// ═══════════════════════════════════════════════════════════

function ServerMiddlePanel({
  serverId,
  selectedAgentId,
  onSelectAgent,
  onDeleteServer,
  onToggleTeam,
  showTeamSidebar,
  currentView,
  onSetView,
}: {
  serverId: string;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onDeleteServer: () => void;
  onToggleTeam: () => void;
  showTeamSidebar: boolean;
  currentView: string | null;
  onSetView: (view: string | null) => void;
}) {
  const { data: channel, isLoading } = useChannel(serverId);
  const router = useRouter();
  const { data: allAgents } = useAgents();
  const deleteChannel = useDeleteChannel();
  const addAgent = useAddChannelAgent();
  const removeAgent = useRemoveChannelAgent();
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showDeleteServerDialog, setShowDeleteServerDialog] = useState(false);
  const [removeAgentId, setRemoveAgentId] = useState<string | null>(null);

  if (isLoading || !channel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  const assignedAgentIds = new Set(channel.agents.map((a) => a.agentId));
  const availableAgents =
    allAgents?.filter((a: any) => !assignedAgentIds.has(a.id)) || [];

  const handleDeleteServer = () => {
    setShowDeleteServerDialog(true);
  };

  const confirmDeleteServer = () => {
    deleteChannel.mutate(serverId, {
      onSuccess: () => {
        toast.success("Server deleted");
        onDeleteServer();
        setShowDeleteServerDialog(false);
      },
      onError: () => toast.error("Failed to delete server"),
    });
  };

  const handleAddAgent = (agentId: string) => {
    addAgent.mutate(
      { channelId: serverId, agentId },
      {
        onSuccess: () => {
          toast.success("Agent added to server");
          setShowAddAgent(false);
        },
        onError: () => toast.error("Failed to add agent"),
      },
    );
  };

  const handleRemoveAgent = (agentId: string) => {
    setRemoveAgentId(agentId);
  };

  const confirmRemoveAgent = () => {
    if (!removeAgentId) return;
    removeAgent.mutate(
      { channelId: serverId, agentId: removeAgentId },
      {
        onSuccess: () => {
          toast.success("Agent removed");
          setRemoveAgentId(null);
        },
        onError: () => toast.error("Failed to remove agent"),
      },
    );
  };

  const removingAgentName =
    channel.agents.find((link) => link.agentId === removeAgentId)?.agent.name ||
    "this agent";

  return (
    <>
      {/* Server Header */}
      <div className="p-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white overflow-hidden"
            style={{ backgroundColor: channel.color || "#6366f1" }}
          >
            {isS3Icon(channel.icon) ? (
              <img
                src={getIconUrl(channel.icon!)}
                alt={channel.name}
                className="w-full h-full object-cover"
              />
            ) : (
              channel.icon || channel.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{channel.name}</h3>
            <span className="text-[10px] text-zinc-500">
              {channel.agents.length} agent
              {channel.agents.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-zinc-400 hover:text-white"
            onClick={() => setShowAddAgent(!showAddAgent)}
            title="Add Agent"
          >
            <Bot className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant={showTeamSidebar ? "secondary" : "ghost"}
            className="h-7 w-7 text-zinc-400 hover:text-white"
            onClick={onToggleTeam}
            title="Team"
          >
            <Users className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant={currentView === "settings" ? "secondary" : "ghost"}
            className="h-7 w-7 text-zinc-400 hover:text-white"
            onClick={() =>
              onSetView(currentView === "settings" ? null : "settings")
            }
            title="Server Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <div className="flex-1" />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-950/30"
            onClick={handleDeleteServer}
            title="Delete Server"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Add Agent Dropdown */}
      {showAddAgent && (
        <div className="p-2 border-b border-zinc-800 bg-zinc-800/50">
          {availableAgents.length === 0 ? (
            <p className="text-xs text-zinc-500 px-2 py-1">
              No available agents.{" "}
              <Link
                href="/agents/explore"
                className="text-indigo-400 hover:underline"
              >
                Explore agents
              </Link>
            </p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {availableAgents.map((agent: any) => (
                <button
                  key={agent.id}
                  onClick={() => handleAddAgent(agent.id)}
                  className="w-full text-left px-2 py-1.5 rounded flex items-center gap-2 text-zinc-300 hover:text-white hover:bg-zinc-700/50"
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                    style={{
                      backgroundColor: agent.avatarColor || "#10b981",
                    }}
                  >
                    {agent.avatar || agent.name.charAt(0)}
                  </div>
                  <span className="text-xs truncate">{agent.name}</span>
                </button>
              ))}
            </div>
          )}
          <Link
            href="/agents/explore"
            className="flex items-center gap-1.5 px-2 py-1.5 mt-1 rounded text-xs text-indigo-400 hover:text-indigo-300 hover:bg-zinc-700/50"
          >
            <Compass className="w-3.5 h-3.5" />
            Explore more agents
          </Link>
        </div>
      )}

      {/* Agent Channels */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex items-center px-2 py-1 mb-1">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
            Agent Channels
          </span>
        </div>

        {channel.agents.length === 0 && (
          <p className="text-xs text-zinc-500 px-2 mt-2">
            No agents yet. Add an agent to start chatting.
          </p>
        )}

        {channel.agents.map((link) => (
          <div
            key={link.id}
            className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
              selectedAgentId === link.agentId
                ? "bg-zinc-700/50 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
            onClick={() => onSelectAgent(link.agentId)}
          >
            <Hash className="w-4 h-4 shrink-0 text-zinc-500" />
            <div className="flex-1 min-w-0">
              <span className="text-sm truncate block">{link.agent.name}</span>
              {link.role === "sub" && (
                <span className="text-[9px] text-zinc-500">sub-agent</span>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/agents/${link.agentId}`);
              }}
              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-indigo-400 transition-opacity"
              title="Configure agent"
            >
              <Wrench className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveAgent(link.agentId);
              }}
              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-opacity"
              title="Remove agent"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-zinc-800">
        <Link href="/agents/new">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-zinc-400 hover:text-white"
          >
            <Bot className="w-3.5 h-3.5 mr-1" />
            Create New Agent
          </Button>
        </Link>
      </div>

      <AlertDialog
        open={showDeleteServerDialog}
        onOpenChange={setShowDeleteServerDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete server?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete server &quot;{channel.name}&quot;? This removes all agent
              assignments and chat history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteServer}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(removeAgentId)}
        onOpenChange={(open) => !open && setRemoveAgentId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove agent?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &quot;{removingAgentName}&quot; from this server?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveAgent}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove Agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Right Panel: Chat with agent in channel
// ═══════════════════════════════════════════════════════════

function AgentThinkingIndicator({ agentName }: { agentName?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2.5 py-2"
    >
      <motion.div
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        className="text-emerald-400"
      >
        <Brain className="h-4 w-4" />
      </motion.div>
      <span className="text-sm text-emerald-400">
        {agentName || "Agent"} is thinking...
      </span>
      <div className="flex items-center gap-0.5 ml-1">
        <motion.span
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0 }}
          className="h-1 w-1 rounded-full bg-emerald-400"
        />
        <motion.span
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
          className="h-1 w-1 rounded-full bg-emerald-400"
        />
        <motion.span
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
          className="h-1 w-1 rounded-full bg-emerald-400"
        />
      </div>
    </motion.div>
  );
}

function ChannelChatPanel({
  channelId,
  agentId,
}: {
  channelId: string;
  agentId: string;
}) {
  const router = useRouter();
  const { data: channel } = useChannel(channelId);
  const { data: historyMessages } = useChannelMessages(channelId, agentId);
  const {
    messages,
    isStreaming,
    streamingContent,
    sendMessage,
    stopStreaming,
    loadMessages,
  } = useChannelChat(channelId, agentId);
  const clearMsgs = useClearMessages();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const agentLink = channel?.agents.find((a) => a.agentId === agentId);
  const agent = agentLink?.agent;

  // Load history
  useEffect(() => {
    if (historyMessages) {
      loadMessages(historyMessages);
    }
  }, [historyMessages, loadMessages]);

  // Auto-scroll
  useEffect(() => {
    if (isNearBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 100;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isNearBottom.current = nearBottom;
    setShowScrollButton(!nearBottom);
  }, []);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
    setInput("");
  };

  const handleClear = () => {
    setShowClearDialog(true);
  };

  const confirmClear = () => {
    clearMsgs.mutate(
      { channelId, agentId },
      {
        onSuccess: () => {
          loadMessages([]);
          toast.success("Messages cleared");
          setShowClearDialog(false);
        },
      },
    );
  };

  return (
    <>
      {/* Chat Header */}
      <div className="h-12 border-b border-zinc-800 flex items-center px-4 gap-2 shrink-0 bg-zinc-900/30">
        <Hash className="w-4 h-4 text-zinc-500" />
        <span className="font-semibold text-sm">
          {agent?.name || "Agent Chat"}
        </span>
        <span className="text-xs text-zinc-500 ml-1">in {channel?.name}</span>
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-zinc-500 hover:text-zinc-300"
            onClick={() => router.push(`/agents/${agentId}`)}
          >
            <Wrench className="w-3 h-3 mr-1" />
            Configure
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-zinc-500 hover:text-zinc-300"
            onClick={handleClear}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.length === 0 && !isStreaming && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <p className="text-sm font-medium text-zinc-400">
              Start chatting with {agent?.name}
            </p>
            <p className="text-xs text-zinc-500 max-w-xs text-center">
              This agent is part of your &quot;{channel?.name}&quot; server.
            </p>
          </motion.div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === "user";
          return (
            <motion.div
              key={msg.id || i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={isUser ? "flex justify-end" : ""}
            >
              {isUser ? (
                <div className="flex items-start gap-3 max-w-[85%] flex-row-reverse">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 mt-0.5">
                    <User className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-sm text-white leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5 text-[10px] font-bold text-white"
                    style={{
                      backgroundColor: agent?.avatarColor || "#10b981",
                    }}
                  >
                    {agent?.avatar || agent?.name?.charAt(0) || "A"}
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none flex-1 min-w-0 leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || "");
                          const text = String(children).replace(/\n$/, "");
                          if (match) {
                            return (
                              <CodeBlock language={match[1]}>{text}</CodeBlock>
                            );
                          }
                          return (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                    {msg.document && <DocumentCard document={msg.document} />}
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}

        {/* Streaming content */}
        {isStreaming && streamingContent && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex items-start gap-3"
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: agent?.avatarColor || "#10b981" }}
            >
              {agent?.avatar || agent?.name?.charAt(0) || "A"}
            </div>
            <div className="prose prose-invert prose-sm max-w-none flex-1 min-w-0 leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || "");
                    const text = String(children).replace(/\n$/, "");
                    if (match) {
                      return <CodeBlock language={match[1]}>{text}</CodeBlock>;
                    }
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {streamingContent}
              </ReactMarkdown>
            </div>
          </motion.div>
        )}

        {/* Thinking indicator */}
        {isStreaming && !streamingContent && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex items-start gap-3"
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: agent?.avatarColor || "#10b981" }}
            >
              {agent?.avatar || agent?.name?.charAt(0) || "A"}
            </div>
            <AnimatePresence mode="wait">
              <AgentThinkingIndicator agentName={agent?.name} />
            </AnimatePresence>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll-to-bottom */}
      <div className="relative">
        <AnimatePresence>
          {showScrollButton && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={() =>
                messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
              }
              className="absolute -top-12 left-1/2 -translate-x-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/80 backdrop-blur-sm shadow-lg hover:bg-zinc-700 transition-colors"
              aria-label="Scroll to bottom"
            >
              <ArrowDown className="h-4 w-4 text-zinc-400" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800 shrink-0 bg-zinc-900/30">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={`Message ${agent?.name || "agent"}...`}
            className="flex-1 bg-zinc-800 border-zinc-700 focus-visible:ring-indigo-500"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button
              onClick={stopStreaming}
              size="icon"
              variant="destructive"
              className="shrink-0"
            >
              <StopCircle className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              size="icon"
              className="bg-indigo-600 hover:bg-indigo-500 shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear messages?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all messages with {agent?.name || "this agent"}{" "}
              in this server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClear}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear Messages
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Subscription Pricing ───

function SubscriptionPricing() {
  const [code, setCode] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setRedeemLoading(true);
    setRedeemResult(null);

    try {
      const res = await apiClient.post<{
        success: boolean;
        creditsGranted?: number | null;
        planGranted?: string | null;
        daysGranted?: number | null;
      }>("/codes/redeem", { code: code.trim().toUpperCase() });

      setRedeemResult({
        success: true,
        message: `Code redeemed! ${res.creditsGranted ? `$${res.creditsGranted} credit added.` : ""} ${res.planGranted ? `${res.planGranted} plan activated for ${res.daysGranted} days.` : ""}`.trim(),
      });
      setCode("");
      // Reload the page after short delay to reflect new subscription
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setRedeemResult({
        success: false,
        message:
          err?.response?.data?.message ||
          err?.message ||
          "Failed to redeem code",
      });
    } finally {
      setRedeemLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm">
            <Zap className="h-4 w-4" />
            AI Agent Portal
          </div>
          <h1 className="text-3xl font-bold mb-3">Get access</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Redeem a code to unlock AI Agents that automate your workflows,
            manage projects, and integrate with your favorite tools.
          </p>
        </div>

        {/* Code Redemption Section */}
        <div className="max-w-md mx-auto mb-10 border rounded-xl p-6 bg-secondary/20">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Redeem a code</span>
          </div>
          <form onSubmit={handleRedeem} className="flex gap-2">
            <Input
              type="text"
              placeholder="PERF-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="font-mono tracking-wider"
              maxLength={14}
              required
            />
            <Button type="submit" disabled={redeemLoading || !code.trim()} size="sm">
              {redeemLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Redeem"
              )}
            </Button>
          </form>
          {redeemResult && (
            <p
              className={`text-xs mt-2 ${
                redeemResult.success
                  ? "text-emerald-500"
                  : "text-destructive"
              }`}
            >
              {redeemResult.message}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Redeem a code to get free credits and a subscription plan instantly.
          </p>
        </div>

        {/* Enterprise request (form comes in RX-32) */}
        <div className="max-w-md mx-auto border rounded-xl p-6 bg-secondary/20">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Need Enterprise?</span>
          </div>
          <Button disabled variant="outline" size="sm">
            Request Enterprise
          </Button>
          <p className="text-xs text-muted-foreground mt-2">Coming soon</p>
        </div>
      </div>
    </div>
  );
}
