"use client";

import { useMemo } from "react";
import { Badge } from "@performa-ai/ui/components/badge";
import { Globe } from "lucide-react";
import { motion } from "framer-motion";

function extractUrls(content: string): { url: string; hostname: string }[] {
  const urlRegex = /https?:\/\/[^\s)\]>]+/g;
  const matches = content.match(urlRegex);
  if (!matches) return [];

  const seen = new Set<string>();
  return matches.reduce<{ url: string; hostname: string }[]>((acc, raw) => {
    const url = raw.replace(/[.,;:!?]+$/, "");
    try {
      const { hostname } = new URL(url);
      if (!seen.has(hostname)) {
        seen.add(hostname);
        acc.push({ url, hostname: hostname.replace(/^www\./, "") });
      }
    } catch {
      /* skip invalid */
    }
    return acc;
  }, []);
}

function getFavicon(hostname: string) {
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
}

export function ResourceBadges({ content }: { content: string }) {
  const sources = useMemo(() => extractUrls(content), [content]);

  if (sources.length === 0) return null;

  const visible = sources.slice(0, 3);
  const extra = sources.length - 3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.1 }}
      className="flex flex-wrap items-center gap-1.5 mt-3 not-prose"
    >
      <Globe className="h-3 w-3 text-muted-foreground mr-0.5" />
      {visible.map(({ url, hostname }) => (
        <Badge
          key={hostname}
          variant="outline"
          asChild
        >
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] py-0.5 px-2 hover:bg-secondary/60 transition-colors"
          >
            <img
              src={getFavicon(hostname)}
              alt=""
              className="h-3 w-3 rounded-sm"
              loading="lazy"
            />
            {hostname}
          </a>
        </Badge>
      ))}
      {extra > 0 && (
        <Badge variant="secondary" className="text-[11px] py-0.5 px-2">
          +{extra}
        </Badge>
      )}
    </motion.div>
  );
}
