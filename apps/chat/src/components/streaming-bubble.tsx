"use client";

import { useChatStore } from "@/lib/stores";
import type { StreamStatus } from "@/lib/api";
import { Sparkles, Brain, Search, PenTool, FileDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";
import { ResourceBadges } from "./resource-badges";

const STATUS_CONFIG: Record<
  StreamStatus,
  { icon: typeof Brain; label: string; color: string }
> = {
  understanding: {
    icon: Brain,
    label: "Understanding your question...",
    color: "text-primary",
  },
  searching_knowledge: {
    icon: Search,
    label: "Searching knowledge base...",
    color: "text-rx-amber-text",
  },
  generating: {
    icon: PenTool,
    label: "Generating response...",
    color: "text-rx-green",
  },
  generating_document: {
    icon: FileDown,
    label: "Generating document...",
    color: "text-primary",
  },
};

function ThinkingIndicator({ status }: { status: StreamStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <motion.div
      key={status}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2.5 py-2"
    >
      <motion.div
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        className={config.color}
      >
        <Icon className="h-4 w-4" />
      </motion.div>
      <span className={`text-sm ${config.color}`}>{config.label}</span>
      <div className="flex items-center gap-0.5 ml-1">
        <motion.span
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0 }}
          className={`h-1 w-1 rounded-full bg-current ${config.color}`}
        />
        <motion.span
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
          className={`h-1 w-1 rounded-full bg-current ${config.color}`}
        />
        <motion.span
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
          className={`h-1 w-1 rounded-full bg-current ${config.color}`}
        />
      </div>
    </motion.div>
  );
}

export function StreamingBubble() {
  const content = useChatStore((s) => s.streamingContent);
  const streamStatus = useChatStore((s) => s.streamStatus);
  const pendingDocument = useChatStore((s) => s.pendingDocument);

  // Hide streamed content when generating a document — only show status indicator
  const isDocumentMode = streamStatus === "generating_document" || !!pendingDocument;
  const showContent = content && !isDocumentMode;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex items-start gap-3"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
        <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
      </div>
      <div className="prose prose-invert prose-sm max-w-none flex-1 min-w-0 leading-relaxed">
        {showContent ? (
          <>
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
            {content}
          </ReactMarkdown>
          <ResourceBadges content={content} />
          </>
        ) : (
          <AnimatePresence mode="wait">
            {streamStatus ? (
              <ThinkingIndicator status={streamStatus} />
            ) : (
              <motion.div
                key="dots"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1 py-2"
              >
                <motion.span
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                  className="h-2 w-2 rounded-full bg-rx-green"
                />
                <motion.span
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                  className="h-2 w-2 rounded-full bg-rx-green"
                />
                <motion.span
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                  className="h-2 w-2 rounded-full bg-rx-green"
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
}
