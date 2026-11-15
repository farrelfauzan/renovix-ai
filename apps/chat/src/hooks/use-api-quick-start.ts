"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import type { ListedModel } from "@/lib/api-key-types";

/** The models by tier (GET /models, public) and the per-key requests per minute (GET /auth/keys/rate-limit). */
export function useApiQuickStart() {
  const models = useQuery<ListedModel[]>({
    queryKey: ["api-quick-start", "models"],
    queryFn: async () => (await apiClient.get<{ data: ListedModel[] }>("/models")).data,
  });
  const rateLimit = useQuery<number>({
    queryKey: ["api-quick-start", "rate-limit"],
    queryFn: async () => (await apiClient.get<{ requestsPerMinute: number }>("/auth/keys/rate-limit")).requestsPerMinute,
  });
  return { models: models.data ?? [], requestsPerMinute: rateLimit.data };
}
