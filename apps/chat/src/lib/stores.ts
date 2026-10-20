import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useState, useEffect } from "react";
import type { StreamStatus, DocumentAttachment } from "./api";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  document?: DocumentAttachment;
}

interface ChatState {
  messages: Message[];
  conversationMessages: Record<string, Message[]>;
  conversationId: string | null;
  isStreaming: boolean;
  streamingConversationId: string | null;
  streamingContent: string;
  streamStatus: StreamStatus | null;
  pendingDocument: DocumentAttachment | null;
  selectedModel: string | null;
  addMessage: (msg: Omit<Message, "id" | "createdAt">) => void;
  setStreaming: (val: boolean, conversationId?: string | null) => void;
  setStreamStatus: (status: StreamStatus | null) => void;
  appendStreamContent: (chunk: string) => void;
  setPendingDocument: (doc: DocumentAttachment) => void;
  finalizeStream: (isJson?: boolean, commitMessage?: boolean) => void;
  setSelectedModel: (model: string | null) => void;
  setConversationId: (id: string | null) => void;
  loadConversation: (
    messages: Omit<Message, "id" | "createdAt">[],
    conversationId: string,
  ) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      conversationMessages: {},
      conversationId: null,
      isStreaming: false,
      streamingConversationId: null,
      streamingContent: "",
      streamStatus: null,
      pendingDocument: null,
      selectedModel: null,

      addMessage: (msg) =>
        set((s) => {
          const nextMessage = {
            ...msg,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
          };
          const nextMessages = [...s.messages, nextMessage];

          return {
            messages: nextMessages,
            conversationMessages: s.conversationId
              ? {
                  ...s.conversationMessages,
                  [s.conversationId]: nextMessages,
                }
              : s.conversationMessages,
          };
        }),

      setStreaming: (val, conversationId) =>
        set({
          isStreaming: val,
          streamingConversationId: val ? (conversationId ?? null) : null,
          streamingContent: val ? "" : get().streamingContent,
          streamStatus: null,
          pendingDocument: val ? null : get().pendingDocument,
        }),

      setStreamStatus: (status) => set({ streamStatus: status }),

      appendStreamContent: (chunk) =>
        set((s) => ({ streamingContent: s.streamingContent + chunk })),

      setPendingDocument: (doc) => set({ pendingDocument: doc }),

      finalizeStream: (isJson, commitMessage = true) => {
        let content = get().streamingContent;
        const document = get().pendingDocument;
        if (content && commitMessage) {
          if (document) {
            // Replace streamed markdown with a short message when document is attached
            content = `I've generated your ${document.format.toUpperCase()} document: **${document.filename}**`;
          } else if (isJson) {
            // Pretty-print and wrap in markdown code block for nice rendering
            try {
              const parsed = JSON.parse(content);
              content = "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
            } catch {
              // If not valid JSON, render as-is
            }
          }
          get().addMessage({
            role: "assistant",
            content,
            ...(document ? { document } : {}),
          });
        }
        set({
          isStreaming: false,
          streamingConversationId: null,
          streamingContent: "",
          streamStatus: null,
          pendingDocument: null,
        });
      },

      setSelectedModel: (model) => set({ selectedModel: model }),

      setConversationId: (id) => {
        if (!id) {
          set({ conversationId: null });
          return;
        }

        const cachedMessages = get().conversationMessages[id];
        set({
          conversationId: id,
          ...(cachedMessages ? { messages: cachedMessages } : {}),
        });
      },

      loadConversation: (msgs, conversationId) =>
        set((s) => {
          const mappedMessages = msgs.map((m) => ({
            ...m,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
          }));

          return {
            messages: mappedMessages,
            conversationId,
            conversationMessages: {
              ...s.conversationMessages,
              [conversationId]: mappedMessages,
            },
          };
        }),

      clearChat: () =>
        set({
          messages: [],
          conversationId: null,
        }),
    }),
    {
      name: "performa-chat",
      partialize: (state) => ({ selectedModel: state.selectedModel }),
    },
  ),
);

// Auth store
interface AuthState {
  jwt: string | null;
  email: string | null;
  name: string | null;
  avatar: string | null;
  sessionAuth: boolean; // true when authenticated via Better Auth (cookie session)
  setAuth: (jwt: string, email: string) => void;
  setSessionAuth: (
    email: string,
    name?: string | null,
    avatar?: string | null,
  ) => void;
  logout: () => void;
  isLoggedIn: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      jwt: null,
      email: null,
      name: null,
      avatar: null,
      sessionAuth: false,
      setAuth: (jwt, email) => {
        if (typeof window !== "undefined") localStorage.setItem("jwt", jwt);
        set({ jwt, email, sessionAuth: false });
      },
      setSessionAuth: (email, name = null, avatar = null) => {
        set({ jwt: null, email, sessionAuth: true, name, avatar });
      },
      logout: () => {
        if (typeof window !== "undefined") localStorage.removeItem("jwt");
        set({
          jwt: null,
          email: null,
          name: null,
          avatar: null,
          sessionAuth: false,
        });
      },
      isLoggedIn: () => !!get().jwt || get().sessionAuth,
    }),
    { name: "performa-auth" },
  ),
);

/**
 * Returns true only after Zustand persist stores have rehydrated from
 * localStorage on the client. Use this to guard any UI that depends on
 * persisted state (auth, etc.) to avoid SSR/client hydration mismatches.
 */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
