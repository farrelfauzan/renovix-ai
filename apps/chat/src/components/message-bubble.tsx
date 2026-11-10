"use client";

import type { Message } from "@/lib/stores";
import { cn } from "@performa-ai/ui/lib/utils";
import { User, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";
import { ResourceBadges } from "./resource-badges";
import { DocumentCard } from "./document-card";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("group relative", isUser ? "flex justify-end" : "")}
    >
      {isUser ? (
        <div className="flex items-start gap-3 max-w-[85%] flex-row-reverse">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
            <User className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground leading-relaxed">
            {message.content}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
            <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
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
              {message.content}
            </ReactMarkdown>
            {message.document && (
              <DocumentCard document={message.document} />
            )}
            <ResourceBadges content={message.content} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
