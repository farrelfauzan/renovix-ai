"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { API_KEYS_QUERY_KEY } from "@/lib/api-keys-query-key";
import type { ApiKeyListItem, CreateApiKeyInput, CreatedApiKey } from "@/lib/api-key-types";
import { useAuthStore, useHydrated } from "@/lib/stores";

/** The signed-in user's API keys (GET /auth/keys); never requested for anonymous visitors. */
export function useApiKeys() {
  const { isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  return useQuery<ApiKeyListItem[]>({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: () => apiClient.get<ApiKeyListItem[]>("/auth/keys"),
    enabled: hydrated && isLoggedIn(),
  });
}

/**
 * Creates a key (POST /auth/keys). Not a TanStack mutation on purpose: a mutation keeps its result in the mutation
 * cache, and the full key must live only in the caller's component state. The list is refetched afterwards; the
 * refusal toast (package limit or other) is the api-client's, nothing is added here.
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const createKey = useCallback(
    async (input: CreateApiKeyInput): Promise<CreatedApiKey | null> => {
      setIsCreating(true);
      try {
        const created = await apiClient.post<CreatedApiKey>("/auth/keys", input);
        await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
        return created;
      } catch {
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [queryClient],
  );
  return { createKey, isCreating };
}

/** Revokes one key (DELETE /auth/keys/:id) and refetches the list. */
export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => apiClient.delete<void>(`/auth/keys/${keyId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY }),
  });
}
