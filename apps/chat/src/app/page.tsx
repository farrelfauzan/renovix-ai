"use client";

import { useCallback, useRef, useState } from "react";
import { ChatHeader } from "@/components/chat-header";
import { ChatMessages, type ChatMessagesHandle } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";
import { useHydrated } from "@/lib/stores";
import { usePortalUsage, usePortalModels } from "@/hooks/use-portal";
import { Loader2, ArrowDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export default function ChatPage() {
  const hydrated = useHydrated();
  const { isLoading: usageLoading } = usePortalUsage();
  const { isLoading: modelsLoading } = usePortalModels();
  const chatMessagesRef = useRef<ChatMessagesHandle>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const handleNearBottomChange = useCallback((nearBottom: boolean) => {
    setShowScrollButton(!nearBottom);
  }, []);

  const contentReady = hydrated && !usageLoading && !modelsLoading;

  return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatHeader />
        {contentReady ? (
          <>
            <ChatMessages ref={chatMessagesRef} onNearBottomChange={handleNearBottomChange} />
            <div className="relative">
              <AnimatePresence>
                {showScrollButton && (
                  <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => chatMessagesRef.current?.scrollToBottom()}
                    className="absolute -top-12 left-1/2 -translate-x-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-secondary/80 backdrop-blur-sm shadow-lg hover:bg-secondary transition-colors duration-200"
                    aria-label="Scroll to bottom"
                  >
                    <ArrowDown className="h-4 w-4 text-muted-foreground" />
                  </motion.button>
                )}
              </AnimatePresence>
              <ChatInput />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
  );
}
