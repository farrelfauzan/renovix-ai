"use client";

import type { DocumentAttachment } from "@/lib/api";
import { FileDown, FileText, FileSpreadsheet } from "lucide-react";
import { motion } from "framer-motion";

const FORMAT_CONFIG: Record<
  string,
  { icon: typeof FileText; label: string; bg: string; border: string }
> = {
  pdf: {
    icon: FileText,
    label: "PDF",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
  },
  docx: {
    icon: FileText,
    label: "Word",
    bg: "bg-accent",
    border: "border-primary/20",
  },
  xlsx: {
    icon: FileSpreadsheet,
    label: "Excel",
    bg: "bg-rx-green/10",
    border: "border-rx-green/20",
  },
};

export function DocumentCard({ document }: { document: DocumentAttachment }) {
  const config = FORMAT_CONFIG[document.format] ?? FORMAT_CONFIG.pdf;
  const Icon = config.icon;

  return (
    <motion.a
      href={document.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex items-center gap-3 rounded-xl border ${config.border} ${config.bg} px-4 py-3 mt-3 hover:brightness-110 transition-all cursor-pointer group max-w-sm`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-5 w-5 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {document.filename}
        </p>
        <p className="text-xs text-muted-foreground">{config.label} document</p>
      </div>
      <FileDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </motion.a>
  );
}
