"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/lib/stores";

type WebSearchProvider = "brave-search" | "duckduckgo";

export interface WebSearchPolicy {
  allowedProviders: WebSearchProvider[];
  preferredProvider: WebSearchProvider;
  maxResults: number;
  dailyLimitPerUser: number;
}

export interface WebSearchStatus {
  connected: boolean;
  provider: "brave-search";
  maskedKey: string | null;
  policy: WebSearchPolicy;
  supportedProviders: WebSearchProvider[];
}

const webSearchKeys = {
  all: ["web-search"] as const,
  status: (workspaceId: string | null) =>
    [...webSearchKeys.all, "status", workspaceId] as const,
  policy: (workspaceId: string | null) =>
    [...webSearchKeys.all, "policy", workspaceId] as const,
};

async function fetchStatus(workspaceId: string): Promise<WebSearchStatus> {
  return apiClient.get(`/integrations/web-search/status?workspaceId=${workspaceId}`);
}

async function fetchPolicy(workspaceId: string): Promise<WebSearchPolicy> {
  return apiClient.get(`/integrations/web-search/policy?workspaceId=${workspaceId}`);
}

async function upsertBraveKey(workspaceId: string, apiKey: string) {
  return apiClient.put("/integrations/web-search/brave/key", {
    workspaceId,
    apiKey,
  });
}

async function deleteBraveKey(workspaceId: string) {
  return apiClient.delete(
    `/integrations/web-search/brave/key?workspaceId=${workspaceId}`,
  );
}

async function updatePolicy(workspaceId: string, data: Partial<WebSearchPolicy>) {
  return apiClient.put("/integrations/web-search/policy", {
    workspaceId,
    ...data,
  });
}

export function useWebSearchStatus(workspaceId: string | null) {
  const { isLoggedIn } = useAuthStore();
  return useQuery({
    queryKey: webSearchKeys.status(workspaceId),
    queryFn: () => fetchStatus(workspaceId!),
    enabled: isLoggedIn() && !!workspaceId,
    staleTime: 30_000,
  });
}

export function useWebSearchPolicy(workspaceId: string | null) {
  const { isLoggedIn } = useAuthStore();
  return useQuery({
    queryKey: webSearchKeys.policy(workspaceId),
    queryFn: () => fetchPolicy(workspaceId!),
    enabled: isLoggedIn() && !!workspaceId,
    staleTime: 30_000,
  });
}

export function useUpsertBraveWebSearchKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, apiKey }: { workspaceId: string; apiKey: string }) =>
      upsertBraveKey(workspaceId, apiKey),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: webSearchKeys.status(vars.workspaceId) });
    },
  });
}

export function useDeleteBraveWebSearchKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId }: { workspaceId: string }) =>
      deleteBraveKey(workspaceId),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: webSearchKeys.status(vars.workspaceId) });
    },
  });
}

export function useUpdateWebSearchPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      data,
    }: {
      workspaceId: string;
      data: Partial<WebSearchPolicy>;
    }) => updatePolicy(workspaceId, data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: webSearchKeys.policy(vars.workspaceId) });
      queryClient.invalidateQueries({ queryKey: webSearchKeys.status(vars.workspaceId) });
    },
  });
}
