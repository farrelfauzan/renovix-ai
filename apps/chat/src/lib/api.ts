import { apiClient } from "./api-client";
import { config } from "./config";

const API_BASE = config.apiUrl;

export function getOrCreateSessionToken(): string {
  if (typeof window === "undefined") return "";
  let token = localStorage.getItem("portal_session");
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem("portal_session", token);
  }
  return token;
}

/** Free-tier daily caps (RX-10): the message is the agreed copy. */
export const FREE_LIMIT_CODES = ["free_limit_reached", "free_capacity_reached"];

export class PortalError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * Error from a failed portal response (RX-92): the portal envelope
 * `{ error: { code, message } }`, else Nest's `{ message }`, else a generic
 * text. Never a raw status line.
 */
export function portalError(body: unknown): PortalError {
  const b = (body ?? {}) as {
    error?: { code?: unknown; message?: unknown } | string;
    message?: unknown;
  };
  const envelope = typeof b.error === "object" && b.error ? b.error : undefined;
  const raw = envelope?.message ?? b.message;
  const message = Array.isArray(raw)
    ? raw.filter((m) => typeof m === "string").join(" ")
    : typeof raw === "string"
      ? raw
      : "";
  const code = typeof envelope?.code === "string" ? envelope.code : undefined;
  return new PortalError(
    message || "Something went wrong. Please try again.",
    code,
  );
}

export type StreamStatus =
  | "understanding"
  | "searching_knowledge"
  | "generating"
  | "generating_document";

export interface DocumentAttachment {
  format: string;
  url: string;
  filename: string;
  expiresAt: string;
}

export type ResponseFormat =
  | {
      type: "json_schema";
      json_schema: { name: string; schema: Record<string, unknown> };
    }
  | { type: "regex"; pattern: string }
  | { type: "json_object" };

export function streamCompletion(
  messages: { role: string; content: string }[],
  model?: string,
  reasoningEffort?: string,
  onChunk?: (text: string) => void,
  onDone?: (conversationId?: string) => void,
  onError?: (err: Error) => void,
  conversationId?: string,
  onStatus?: (status: StreamStatus) => void,
  responseFormat?: ResponseFormat,
  onDocument?: (doc: DocumentAttachment) => void,
): AbortController {
  const controller = new AbortController();
  const sessionToken = getOrCreateSessionToken();
  const jwt =
    typeof window !== "undefined" ? localStorage.getItem("jwt") : null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Portal-Session": sessionToken,
  };
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;

  let receivedConversationId: string | undefined;

  fetch(`${API_BASE}/chat/portal/completions`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({
      messages,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw portalError(body);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      // A provider failure after the 200 arrives as `data: {"error":{...}}`
      let streamError: PortalError | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              onDone?.(receivedConversationId);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              // Mid-stream error event (RX-92): stop and report it below,
              // outside this try, whose catch would swallow a throw
              if (parsed.error) {
                streamError = portalError(parsed);
                break;
              }
              // Check for status event
              if (parsed.status) {
                onStatus?.(parsed.status);
                continue;
              }
              // Check for document event
              if (parsed.document) {
                onDocument?.(parsed.document);
                continue;
              }
              // Check for conversation_id event
              if (parsed.conversation_id) {
                receivedConversationId = parsed.conversation_id;
                continue;
              }
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) onChunk?.(content);
            } catch {
              // skip non-JSON lines
            }
          }
        }
        if (streamError) {
          await reader.cancel().catch(() => {});
          throw streamError;
        }
      }
      onDone?.(receivedConversationId);
    })
    .catch((err) => {
      if (err.name !== "AbortError") onError?.(err);
    });

  return controller;
}

// ─── Conversation History API ───

export interface ConversationSummary {
  id: string;
  title: string | null;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    document?: DocumentAttachment;
    createdAt: string;
  }[];
}

export async function fetchConversations(
  limit = 20,
  offset = 0,
): Promise<{ data: ConversationSummary[]; total: number }> {
  return apiClient.get("/chat/portal/conversations", {
    params: { limit, offset },
  });
}

export async function fetchConversation(
  id: string,
): Promise<ConversationDetail> {
  return apiClient.get(`/chat/portal/conversations/${id}`);
}

export async function deleteConversation(id: string): Promise<void> {
  await apiClient.delete(`/chat/portal/conversations/${id}`);
}

// ─── Knowledge Base API ───

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { chunks: number };
}

export interface KnowledgeChunk {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  tokenCount: number;
  createdAt: string;
}

export async function fetchKnowledgeBases(): Promise<KnowledgeBase[]> {
  return apiClient.get("/chat/portal/knowledge");
}

export async function createKnowledgeBase(data: {
  name: string;
  description?: string;
}): Promise<KnowledgeBase> {
  return apiClient.post("/chat/portal/knowledge", data);
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  await apiClient.delete(`/chat/portal/knowledge/${id}`);
}

export async function uploadKnowledgeBaseFile(
  knowledgeBaseId: string,
  file: File,
): Promise<{ filename: string; s3Key: string; chunksInserted: number }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.post(
    `/chat/portal/knowledge/${knowledgeBaseId}/upload`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
}

export async function fetchKnowledgeChunks(
  knowledgeBaseId: string,
  limit = 50,
  offset = 0,
): Promise<{ chunks: KnowledgeChunk[]; total: number }> {
  return apiClient.get(`/chat/portal/knowledge/${knowledgeBaseId}/chunks`, {
    params: { limit, offset },
  });
}

export async function deleteKnowledgeChunk(
  knowledgeBaseId: string,
  chunkId: string,
): Promise<void> {
  await apiClient.delete(
    `/chat/portal/knowledge/${knowledgeBaseId}/chunks/${chunkId}`,
  );
}

// ─── User Memory API ───

export interface UserMemoryItem {
  id: string;
  type: "interest" | "preference" | "context" | "exclusion";
  content: string;
  confidence: number;
  isUserPinned: boolean;
  status: string;
  lastConfirmedAt: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchMemories(): Promise<{ data: UserMemoryItem[] }> {
  return apiClient.get("/chat/portal/memory");
}

export async function updateMemory(
  id: string,
  data: { content?: string; isUserPinned?: boolean },
): Promise<UserMemoryItem> {
  return apiClient.patch(`/chat/portal/memory/${id}`, data);
}

export async function deleteMemory(id: string): Promise<void> {
  await apiClient.delete(`/chat/portal/memory/${id}`);
}

export async function clearAllMemories(): Promise<{ cleared: number }> {
  return apiClient.post("/chat/portal/memory/clear");
}
