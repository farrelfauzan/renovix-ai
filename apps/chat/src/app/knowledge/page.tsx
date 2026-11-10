"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  Trash2,
  ChevronRight,
  BookOpen,
  ArrowLeft,
  Lock,
} from "lucide-react";
import { Button } from "@performa-ai/ui/components/button";
import Link from "next/link";
import { useAuthStore, useHydrated } from "@/lib/stores";
import {
  useKnowledgeBases,
  useDeleteKnowledgeBase,
  useKnowledgeChunks,
  useDeleteKnowledgeChunk,
} from "@/hooks/use-knowledge";
import { KBUploadDialog } from "@/components/kb-upload-dialog";
import { AppSidebar } from "@/components/chat-sidebar";
import { SidebarProvider, SidebarInset } from "@performa-ai/ui/components/sidebar";

export default function KnowledgePage() {
  const [showUpload, setShowUpload] = useState(false);
  const [expandedKB, setExpandedKB] = useState<string | null>(null);
  const hydrated = useHydrated();
  const { isLoggedIn } = useAuthStore();
  const { data: knowledgeBases, isLoading } = useKnowledgeBases();
  const deleteMutation = useDeleteKnowledgeBase();

  if (!hydrated) return null;

  if (!isLoggedIn()) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8">
        <Lock className="h-12 w-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold mb-2">Knowledge Base</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Upload documents to give the AI context from your own files. Sign in
          to get started.
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
            <BookOpen className="h-5 w-5 text-primary" />
            <h1 className="font-semibold text-lg">Knowledge Base</h1>
          </div>
        </header>

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">
            Upload .md files to give the AI context from your own documents.
          </p>
          <Button onClick={() => setShowUpload(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Knowledge Base
          </Button>
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
        ) : !knowledgeBases || knowledgeBases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">
              No knowledge bases yet. Upload your first document to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {knowledgeBases.map((kb) => (
              <div
                key={kb.id}
                className="rounded-lg border border-border/50 bg-secondary/20 overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() =>
                      setExpandedKB(expandedKB === kb.id ? null : kb.id)
                    }
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <ChevronRight
                      className={`h-4 w-4 shrink-0 transition-transform ${
                        expandedKB === kb.id ? "rotate-90" : ""
                      }`}
                    />
                    <span className="font-medium text-sm truncate">
                      {kb.name}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {kb._count.chunks} chunks
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => deleteMutation.mutate(kb.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <AnimatePresence>
                  {expandedKB === kb.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <KBChunksSection knowledgeBaseId={kb.id} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>

      <KBUploadDialog open={showUpload} onClose={() => setShowUpload(false)} />
      </SidebarInset>
    </SidebarProvider>
  );
}

function KBChunksSection({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { data, isLoading } = useKnowledgeChunks(knowledgeBaseId);
  const deleteMutation = useDeleteKnowledgeChunk();

  if (isLoading) {
    return (
      <div className="px-4 py-3 border-t border-border/30 text-xs text-muted-foreground">
        Loading chunks...
      </div>
    );
  }

  if (!data?.chunks?.length) {
    return (
      <div className="px-4 py-3 border-t border-border/30 text-xs text-muted-foreground">
        No chunks
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t border-border/30 space-y-2 max-h-64 overflow-y-auto">
      {data.chunks.map((chunk) => (
        <div
          key={chunk.id}
          className="flex items-start gap-2 rounded-md bg-background/50 px-3 py-2"
        >
          <p className="text-xs text-muted-foreground flex-1 line-clamp-2">
            {chunk.content.slice(0, 200)}
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() =>
              deleteMutation.mutate({ knowledgeBaseId, chunkId: chunk.id })
            }
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      ))}
      {data.total > data.chunks.length && (
        <p className="text-xs text-muted-foreground text-center py-1">
          +{data.total - data.chunks.length} more chunks
        </p>
      )}
    </div>
  );
}
