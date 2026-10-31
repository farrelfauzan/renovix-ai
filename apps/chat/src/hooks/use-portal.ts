"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";

export interface PortalUsage {
  tier: "free" | "paid";
  used?: number;
  limit?: number;
  remaining?: number;
  balance?: string;
  unlimited?: boolean;
}

export interface PortalModel {
  slug: string;
  name: string;
  tier?: string;
  inputPrice?: string;
  outputPrice?: string;
}

export function usePortalUsage() {
  return useQuery<PortalUsage>({
    queryKey: ["portal-usage"],
    queryFn: () => apiClient.get<PortalUsage>("/chat/portal/usage"),
    refetchInterval: 30000,
  });
}

export function usePortalModels() {
  return useQuery<PortalModel[]>({
    queryKey: ["portal-models"],
    queryFn: async () => {
      const res = await apiClient.get<{ models: PortalModel[] }>(
        "/chat/portal/models",
      );
      return res.models;
    },
    staleTime: 60000,
  });
}
