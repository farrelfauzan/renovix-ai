"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAgent, useAgentRuns, useAgentRun } from "@/hooks/use-agents";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { useAgentStore } from "@/lib/agent-store";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import {
  ArrowLeft,
  ArrowDown,
  Send,
  Plus,
  MessageSquare,
  StopCircle,
  Bot,
  Home,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@performa-ai/ui/components/scroll-area";
import { DocumentCard } from "@/components/document-card";

export default function AgentChatPageClient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: agent } = useAgent(id);
  const { data: runs } = useAgentRuns(id);
  const {
    agentMessages,
    setAgentMessages,
    activeRunId,
    setActiveRunId,
    isAgentStreaming,
    streamingAgentContent,
  } = useAgentStore();
  console.log("Active Run ID:", activeRunId);
  console.log("Agent Messages:", agentMessages);
  const { sendMessage, stopStreaming, isStreaming } = useAgentChat(id);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottom = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Load run messages when activeRunId changes
  const { data: runData } = useAgentRun(
    id,
    activeRunId,
  );

  useEffect(() => {
    if (runData?.messages) {
      setAgentMessages(runData.messages);
    }
  }, [runData, setAgentMessages]);

  // Auto-scroll only when near bottom
  useEffect(() => {
    if (isNearBottom.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [agentMessages, streamingAgentContent]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 100;
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    isNearBottom.current = nearBottom;
    setShowScrollButton(!nearBottom);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || isStreaming) return;
    setInput("");
    sendMessage(msg);
  };

  const handleNewConversation = () => {
    setActiveRunId(null);
    setAgentMessages([]);
  };

  const handleSelectRun = (runId: string) => {
    setActiveRunId(runId);
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar - Run History */}
      <div className="w-64 border-r flex flex-col">
        <div className="p-4 border-b">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleNewConversation}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Chat
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {runs?.map((run) => (
              <button
                key={run.id}
                onClick={() => handleSelectRun(run.id)}
                className={`w-full text-left p-2.5 rounded-lg text-sm transition-colors ${
                  activeRunId === run.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {run.messages?.[0]?.content?.slice(0, 30) ||
                      `Session ${run.sessionId.slice(0, 8)}`}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground mt-0.5 block">
                  {run._count?.messages || 0} messages
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/agents/${id}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
            {agent?.avatar || "🤖"}
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm">{agent?.name || "Agent"}</p>
            <p className="text-xs text-muted-foreground">
              {agent?.description || "AI Agent"}
            </p>
          </div>
          <Link href="/">
            <Button variant="ghost" size="sm">
              <Home className="h-4 w-4 mr-2" />
              Back to Chat
            </Button>
          </Link>
        </div>

        {/* Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4"
        >
          <div className="max-w-3xl mx-auto space-y-6">
            {agentMessages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Bot className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-1">
                  Chat with {agent?.name || "Agent"}
                </h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {agent?.description ||
                    "Send a message to start a conversation with this agent."}
                </p>
              </div>
            )}

            {agentMessages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((msg) => (
                <div
                  key={msg.id}
                  className={`group relative ${msg.role === "user" ? "flex justify-end" : ""}`}
                >
                  {msg.role === "user" ? (
                    <div className="flex items-start gap-3 max-w-[85%] flex-row-reverse">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
                        <span className="text-xs text-primary-foreground font-medium">U</span>
                      </div>
                      <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
                        <Bot className="h-3.5 w-3.5 text-primary-foreground" />
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
                                  <pre className="bg-muted rounded-lg p-4 overflow-x-auto my-3">
                                    <code className={`language-${match[1]} text-sm`}>
                                      {text}
                                    </code>
                                  </pre>
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
                </div>
              ))}

            {/* Streaming content */}
            {isAgentStreaming && streamingAgentContent && (
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-primary-foreground" />
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
                            <pre className="bg-muted rounded-lg p-4 overflow-x-auto my-3">
                              <code className={`language-${match[1]} text-sm`}>
                                {text}
                              </code>
                            </pre>
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
                    {streamingAgentContent}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Typing indicator */}
            {isAgentStreaming && !streamingAgentContent && (
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
                <div className="flex items-center gap-1 py-2">
                  <span className="h-2 w-2 rounded-full bg-rx-green animate-pulse" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 rounded-full bg-rx-green animate-pulse" style={{ animationDelay: "200ms" }} />
                  <span className="h-2 w-2 rounded-full bg-rx-green animate-pulse" style={{ animationDelay: "400ms" }} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
            <button
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-secondary/80 backdrop-blur-sm shadow-lg hover:bg-secondary transition-colors"
            >
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t">
          <form
            onSubmit={handleSubmit}
            className="max-w-3xl mx-auto flex gap-2"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${agent?.name || "Agent"}...`}
              disabled={isStreaming}
              className="flex-1"
            />
            {isStreaming ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={stopStreaming}
              >
                <StopCircle className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
