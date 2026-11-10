"use client";

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { useChatStore } from "@/lib/stores";
import { MessageBubble } from "./message-bubble";
import { StreamingBubble } from "./streaming-bubble";
import { motion } from "framer-motion";
import { Sparkles, Zap, Globe, Code } from "lucide-react";

const suggestions = [
  { icon: Zap, text: "Explain quantum computing simply" },
  { icon: Code, text: "Write a Python script to sort files" },
  { icon: Globe, text: "Summarize today's AI news" },
  { icon: Sparkles, text: "Help me brainstorm startup ideas" },
];

export interface ChatMessagesHandle {
  scrollToBottom: () => void;
}

export const ChatMessages = forwardRef<ChatMessagesHandle, { onNearBottomChange?: (nearBottom: boolean) => void }>(function ChatMessages({ onNearBottomChange }, ref) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const conversationId = useChatStore((s) => s.conversationId);
  const streamingConversationId = useChatStore((s) => s.streamingConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const isNearBottom = useRef(true);
  const prevMessageCount = useRef(0);
  const isStreamingForCurrentConversation =
    isStreaming && conversationId === streamingConversationId;

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      const container = scrollRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    },
  }));

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const threshold = 100;
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      threshold;
    isNearBottom.current = nearBottom;
    onNearBottomChange?.(nearBottom);
  }, [onNearBottomChange]);

  // Force scroll to bottom when a new message is added (user sent a message)
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (messages.length > prevMessageCount.current) {
      isNearBottom.current = true;
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
    prevMessageCount.current = messages.length;
  }, [messages]);

  // Auto-scroll during streaming only if near bottom
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !isNearBottom.current) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [streamingContent, isStreamingForCurrentConversation]);

  if (messages.length === 0 && !isStreamingForCurrentConversation) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center space-y-8 max-w-lg"
        >
          <div className="space-y-3">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent border border-primary/10"
            >
              <Sparkles className="h-6 w-6 text-primary" />
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="text-xl font-medium text-foreground"
            >
              What can I help with?
            </motion.h2>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4 }}
            className="grid grid-cols-2 gap-2"
          >
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  // Trigger input from suggestion
                  const input = document.querySelector<HTMLTextAreaElement>(
                    "textarea",
                  );
                  if (input) {
                    const nativeInputValueSetter =
                      Object.getOwnPropertyDescriptor(
                        window.HTMLTextAreaElement.prototype,
                        "value",
                      )?.set;
                    nativeInputValueSetter?.call(input, s.text);
                    input.dispatchEvent(
                      new Event("input", { bubbles: true }),
                    );
                    input.focus();
                  }
                }}
                className="group flex items-center gap-2.5 rounded-xl border border-border/40 bg-secondary/20 px-3.5 py-3 text-left text-xs text-muted-foreground transition-all duration-200 hover:bg-secondary/40 hover:border-indigo-500/30 hover:text-foreground"
              >
                <s.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-primary transition-colors" />
                <span className="line-clamp-1">{s.text}</span>
              </button>
            ))}
          </motion.div>
        </motion.div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isStreamingForCurrentConversation && <StreamingBubble />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});
