"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateKnowledgeBase, useUploadKBFile } from "@/hooks/use-knowledge";
import { toast } from "sonner";

interface KBUploadDialogProps {
  open: boolean;
  onClose: () => void;
}

type Step = "create" | "upload" | "done";

export function KBUploadDialog({ open, onClose }: KBUploadDialogProps) {
  const [step, setStep] = useState<Step>("create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kbId, setKbId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    filename: string;
    chunksInserted: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const createMutation = useCreateKnowledgeBase();
  const uploadMutation = useUploadKBFile();

  const reset = useCallback(() => {
    setStep("create");
    setName("");
    setDescription("");
    setKbId(null);
    setFile(null);
    setUploadResult(null);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = async () => {
    if (!name.trim()) return;

    try {
      const kb = await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setKbId(kb.id);
      setStep("upload");
      toast.success("Knowledge base created");
    } catch {
      toast.error("Failed to create knowledge base");
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.name.endsWith(".md")) {
      setFile(dropped);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected && selected.name.endsWith(".md")) {
      setFile(selected);
    }
  };

  const handleUpload = async () => {
    if (!file || !kbId) return;

    try {
      const result = await uploadMutation.mutateAsync({
        knowledgeBaseId: kbId,
        file,
      });
      setUploadResult(result);
      setStep("done");
      toast.success("Document uploaded successfully");
    } catch {
      toast.error("Failed to upload document");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {step === "create" && "Create Knowledge Base"}
            {step === "upload" && "Upload Document"}
            {step === "done" && "Upload Complete"}
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === "create" && (
            <motion.div
              key="create"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <label className="text-xs font-medium">Name *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Project Documentation"
                  className="h-9 text-sm"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium">
                  Description (optional)
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of this knowledge base"
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={!name.trim() || createMutation.isPending}
                  className="h-8 text-xs gap-1.5"
                >
                  {createMutation.isPending && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  Continue
                </Button>
              </div>
            </motion.div>
          )}

          {step === "upload" && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
                  dragOver
                    ? "border-primary bg-accent"
                    : "border-border/60 hover:border-border"
                }`}
              >
                <Upload
                  className={`h-8 w-8 ${dragOver ? "text-primary" : "text-muted-foreground"}`}
                />
                <div className="text-center">
                  <p className="text-xs font-medium">
                    {file
                      ? file.name
                      : "Drop a .md file here or click to browse"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Markdown files only, max 10 MB
                  </p>
                </div>

                {file && (
                  <div className="flex items-center gap-1.5 mt-2 rounded-md bg-secondary/50 px-2 py-1">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px]">{file.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                      }}
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".md"
                className="hidden"
                onChange={handleFileSelect}
              />

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  className="h-8 text-xs"
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  onClick={handleUpload}
                  disabled={!file || uploadMutation.isPending}
                  className="h-8 text-xs gap-1.5"
                >
                  {uploadMutation.isPending && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  Upload & Process
                </Button>
              </div>
            </motion.div>
          )}

          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-4"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rx-green/10">
                <Check className="h-5 w-5 text-rx-green" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Upload Successful</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {uploadResult?.filename} — {uploadResult?.chunksInserted}{" "}
                  chunks created
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleClose}
                className="h-8 text-xs mt-2"
              >
                Done
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
