"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUp, Square, Sparkles, LogIn } from "lucide-react";
import { useAuthStore, useChatStore, useHydrated } from "@/lib/stores";
import { usePortalUsage, usePortalModels } from "@/hooks/use-portal";
import {
  FREE_LIMIT_CODES,
  PortalError,
  streamCompletion,
  type ResponseFormat,
} from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

const LOW_REQUEST_THRESHOLD = 5;

const MODELS_WITH_REASONING_SUPPORT = [
  "minimax-m2.7",
  "deepseek-v4-pro",
  "glm-5.1",
  "glm-5",
  "kimi-k2.6",
  "kimi-k2.5",
  "qwen-3.6-plus",
  "qwen-3.5-397b-a17b",
  "qwen-3.5-9b",
  "cogito-v2.1-671b",
  "gpt-oss-120b",
  "gpt-oss-20b",
];

export function ChatInput() {
  const [input, setInput] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<string>("medium");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const {
    messages,
    isStreaming,
    conversationId,
    streamingConversationId,
    addMessage,
    setStreaming,
    setStreamStatus,
    appendStreamContent,
    finalizeStream,
    selectedModel,
    setSelectedModel,
    setConversationId,
    setPendingDocument,
  } = useChatStore();
  const { isLoggedIn } = useAuthStore();
  const { data: usage } = usePortalUsage();
  const { data: models } = usePortalModels();
  const queryClient = useQueryClient();
  const hydrated = useHydrated();

  const isPaid = usage?.tier === "paid";
  const remaining = usage?.remaining ?? 20;
  const showCta =
    hydrated && !isPaid && !isLoggedIn() && remaining <= LOW_REQUEST_THRESHOLD;
  const hasModels = hydrated && models && models.length > 0;
  const defaultModel = models?.[0]?.slug ?? null;

  // Auto-select default model when models load and none is selected
  useEffect(() => {
    if (!hasModels) return;
    // If persisted model isn't in available list, reset to default
    if (selectedModel && !models.some((m) => m.slug === selectedModel)) {
      setSelectedModel(defaultModel);
    } else if (!selectedModel) {
      setSelectedModel(defaultModel);
    }
  }, [hasModels, selectedModel, defaultModel, models, setSelectedModel]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    // Detect /json command prefix
    let userText = text;
    let responseFormat: ResponseFormat | undefined;
    if (text.startsWith("/json ")) {
      userText = text.slice(6).trim();
      responseFormat = { type: "json_object" };
    }

    addMessage({ role: "user", content: userText });
    setInput("");
    const streamOriginConversationId = conversationId;
    setStreaming(true, streamOriginConversationId);

    const allMessages = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText },
    ];

    // When using JSON mode, prepend instruction to respond in JSON
    if (responseFormat) {
      allMessages.unshift({
        role: "system",
        content: "You must respond only in valid JSON format. Structure your response as a JSON object with relevant keys.",
      });
    }

    abortRef.current = streamCompletion(
      allMessages,
      selectedModel || undefined,
      reasoningEffort,
      (chunk) => appendStreamContent(chunk),
      (returnedConversationId) => {
        const currentConversationId = useChatStore.getState().conversationId;
        const shouldCommitMessage =
          currentConversationId === streamOriginConversationId ||
          (streamOriginConversationId === null && currentConversationId === null);

        finalizeStream(!!responseFormat, shouldCommitMessage);

        if (returnedConversationId && shouldCommitMessage) {
          setConversationId(returnedConversationId);
        }
        queryClient.invalidateQueries({ queryKey: ["portal-usage"] });
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      },
      (err) => {
        const currentConversationId = useChatStore.getState().conversationId;
        const shouldCommitMessage =
          currentConversationId === streamOriginConversationId ||
          (streamOriginConversationId === null && currentConversationId === null);

        finalizeStream(undefined, shouldCommitMessage);
        if (shouldCommitMessage) {
          // Free-tier caps: the agreed copy plus ways to keep chatting (RX-92)
          const freeLimit =
            err instanceof PortalError &&
            !!err.code &&
            FREE_LIMIT_CODES.includes(err.code);
          addMessage({
            role: "assistant",
            content: freeLimit
              ? `${err.message}\n\n[Sign in](/login) · [Redeem an invitation code](/top-up)`
              : `Error: ${err.message}`,
          });
        }
      },
      conversationId || undefined,
      (status) => setStreamStatus(status),
      responseFormat,
      (doc) => setPendingDocument(doc),
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
    const shouldCommitMessage = conversationId === streamingConversationId;
    finalizeStream(undefined, shouldCommitMessage);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="shrink-0 px-4 pb-6 pt-2"
    >
      <div className="max-w-3xl mx-auto">
        {/* Invitation CTA card */}
        <AnimatePresence>
          {showCta && (
            <motion.div
              initial={{ opacity: 0, y: 10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: 10, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-3 overflow-hidden"
            >
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 backdrop-blur-sm p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-indigo-500 to-purple-600">
                    <Sparkles className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {remaining === 0
                        ? "You've used all free requests"
                        : `Only ${remaining} free request${remaining === 1 ? "" : "s"} remaining`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Sign in and top up to unlock all models, unlimited
                      requests, and conversation history.
                    </p>
                  </div>
                  <Link href="/login" className="shrink-0">
                    <Button
                      size="sm"
                      className="h-8 rounded-lg text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-500"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      Sign In
                    </Button>
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat input box */}
        <div className="relative rounded-2xl border border-border/50 bg-secondary/30 backdrop-blur-sm shadow-lg focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all duration-200">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Renovix AI..."
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-12 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none min-h-13 max-h-50"
            rows={1}
            disabled={isStreaming}
          />
          <div className="absolute bottom-2.5 left-3 right-2.5 flex items-center justify-between">
            {/* Model indicator */}
            <div>
              {hasModels && !isPaid ? (
                <span className="text-[11px] text-muted-foreground/60">
                  {models[0].name}
                </span>
              ) : null}
            </div>

            {/* Send / Stop button */}
            <div className="flex items-center gap-2">
              {isStreaming ? (
                <Button
                  onClick={handleStop}
                  size="icon"
                  className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 text-foreground"
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  size="icon"
                  className="h-8 w-8 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:bg-muted transition-all duration-200"
                >
                  <ArrowUp className="h-4 w-4 text-white" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Model selector below input (paid users only) */}
        {hasModels && isPaid ? (
          <div className="flex flex-row gap-2 mt-2 px-1">
            <div className="flex items-center gap-2">
              <Select
                value={selectedModel || defaultModel || ""}
                onValueChange={(v) => setSelectedModel(v || null)}
              >
                <SelectTrigger size="sm" className="h-7 w-auto text-[11px] border-border/30 bg-secondary/40 rounded-lg gap-1 px-2.5 hover:bg-secondary/60 transition-colors">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent position="popper" side="top" sideOffset={4}>
                  {models.map((m) => (
                    <SelectItem
                      key={m.slug}
                      value={m.slug}
                      className="text-xs"
                    >
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Reasoning effort selector (only for supported models) */}
            {MODELS_WITH_REASONING_SUPPORT.includes(selectedModel || "") ? (
              <div className="flex items-center gap-2">
                <Select
                  value={reasoningEffort}
                  onValueChange={setReasoningEffort}
                >
                  <SelectTrigger size="sm" className="h-7 w-auto text-[11px] border-border/30 bg-secondary/40 rounded-lg gap-1 px-2.5 hover:bg-secondary/60 transition-colors">
                    <SelectValue placeholder="Reasoning effort" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="top" sideOffset={4}>
                    <SelectItem value="low" className="text-xs">
                      Low
                    </SelectItem>
                    <SelectItem value="medium" className="text-xs">
                      Medium
                    </SelectItem>
                    <SelectItem value="high" className="text-xs">
                      High
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="text-center text-[11px] text-muted-foreground/50 mt-2.5">
          Renovix AI can make mistakes. Verify important information.
        </p>
      </div>
    </motion.div>
  );
}
