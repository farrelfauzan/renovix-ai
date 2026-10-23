"use client";

import { useCallback, useRef } from "react";
import { useAgentStore } from "@/lib/agent-store";
import { config } from "@/lib/config";

export function useAgentChat(agentId: string) {
  const {
    isAgentStreaming,
    setAgentStreaming,
    setStreamingAgentContent,
    appendStreamingAgentContent,
    addAgentMessage,
    setStreamingRunId,
    activeRunId,
    setActiveRunId,
  } = useAgentStore();

  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (
      message: string,
      options?: { output_format?: "pdf" | "docx" | "xlsx" },
    ) => {
      if (isAgentStreaming) return;

      // Add user message immediately
      addAgentMessage({
        id: crypto.randomUUID(),
        runId: activeRunId || "",
        role: "user",
        content: message,
        createdAt: new Date().toISOString(),
      });

      setAgentStreaming(true);
      setStreamingAgentContent("");

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch(
          `${config.apiUrl}/agents/${agentId}/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message,
              sessionId: activeRunId || undefined,
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
        let documentData:
          | { format: string; url: string; filename: string; expiresAt: string }
          | undefined;

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

              // Handle session info
              if (parsed.sessionId) {
                setStreamingRunId(parsed.runId);
                setActiveRunId(parsed.sessionId);
                continue;
              }

              // Handle status events
              if (parsed.status) continue;

              // Handle document event
              if (parsed.document) {
                documentData = parsed.document;
                continue;
              }

              // Handle error
              if (parsed.error) {
                throw new Error(parsed.error.message);
              }

              // Handle completion chunks
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                appendStreamingAgentContent(delta);
              }
            } catch (e) {
              // Skip parse errors on individual lines
              if (
                e instanceof Error &&
                e.message !== "Unexpected end of JSON input"
              ) {
                // Only throw real errors, not parse errors
                if ((e as any).message && !data.startsWith("{")) continue;
              }
            }
          }
        }

        // Finalize: add assistant message
        if (fullContent) {
          addAgentMessage({
            id: crypto.randomUUID(),
            runId: activeRunId || "",
            role: "assistant",
            content: fullContent,
            createdAt: new Date().toISOString(),
            ...(documentData ? { document: documentData } : {}),
          });
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        // Add error as assistant message
        addAgentMessage({
          id: crypto.randomUUID(),
          runId: activeRunId || "",
          role: "assistant",
          content: `Error: ${err.message}`,
          createdAt: new Date().toISOString(),
        });
      } finally {
        setAgentStreaming(false);
        setStreamingAgentContent("");
        abortControllerRef.current = null;
      }
    },
    [
      agentId,
      isAgentStreaming,
      activeRunId,
      addAgentMessage,
      setAgentStreaming,
      setStreamingAgentContent,
      appendStreamingAgentContent,
      setStreamingRunId,
      setActiveRunId,
    ],
  );

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    setAgentStreaming(false);
  }, [setAgentStreaming]);

  return {
    sendMessage,
    stopStreaming,
    isStreaming: isAgentStreaming,
  };
}
