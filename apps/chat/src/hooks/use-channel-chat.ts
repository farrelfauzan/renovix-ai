"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { config } from "@/lib/config";
import { channelKeys } from "./use-channels";
import type { ChannelMessage } from "./use-channels";

export function useChannelChat(
  channelId: string | null,
  agentId: string | null,
) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const sendMessage = useCallback(
    async (
      message: string,
      options?: { output_format?: "pdf" | "docx" | "xlsx" },
    ) => {
      if (!channelId || !agentId || isStreaming) return;

      // Add user message immediately
      const userMsg: ChannelMessage = {
        id: crypto.randomUUID(),
        channelAgentId: agentId,
        role: "user",
        content: message,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingContent("");

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let documentData:
        | { format: string; url: string; filename: string; expiresAt: string }
        | undefined;

      try {
        const response = await fetch(
          `${config.apiUrl}/channels/${channelId}/agents/${agentId}/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message,
              ...(options?.output_format
                ? { output_format: options.output_format }
                : {}),
            }),
            credentials: "include",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(errorData?.message || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);

            if (data === "[DONE]") break;

            try {
              const parsed = JSON.parse(data);

              if (parsed.status) continue;
              if (parsed.done) continue;
              if (parsed.document) {
                documentData = parsed.document;
                continue;
              }
              if (parsed.error) {
                throw new Error(parsed.error.message);
              }

              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                setStreamingContent((prev) => prev + delta);
              }
            } catch (e) {
              if (
                e instanceof Error &&
                e.message !== "Unexpected end of JSON input"
              ) {
                if ((e as any).message && !data.startsWith("{")) continue;
              }
            }
          }
        }

        // Add assistant message
        if (fullContent) {
          const assistantMsg: ChannelMessage = {
            id: crypto.randomUUID(),
            channelAgentId: agentId,
            role: "assistant",
            content: fullContent,
            createdAt: new Date().toISOString(),
            ...(documentData ? { document: documentData } : {}),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }
      } catch (error: any) {
        if (error.name !== "AbortError") {
          const errorMsg: ChannelMessage = {
            id: crypto.randomUUID(),
            channelAgentId: agentId,
            role: "assistant",
            content: `Error: ${error.message}`,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        }
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
        abortControllerRef.current = null;
        queryClient.invalidateQueries({
          queryKey: channelKeys.messages(channelId, agentId),
        });
      }
    },
    [channelId, agentId, isStreaming, queryClient],
  );

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const loadMessages = useCallback((msgs: ChannelMessage[]) => {
    setMessages(msgs);
  }, []);

  return {
    messages,
    isStreaming,
    streamingContent,
    sendMessage,
    stopStreaming,
    loadMessages,
  };
}
