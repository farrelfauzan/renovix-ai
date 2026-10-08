"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  Agent,
  AgentRun,
  AgentTool,
  AgentIntegration,
  AgentChannel,
} from "@/lib/agent-store";

// ─── Query Keys ───

export const agentKeys = {
  all: ["agents"] as const,
  list: () => [...agentKeys.all, "list"] as const,
  detail: (id: string) => [...agentKeys.all, "detail", id] as const,
  runs: (id: string) => [...agentKeys.all, "runs", id] as const,
  run: (id: string, runId: string) =>
    [...agentKeys.all, "run", id, runId] as const,
  public: () => [...agentKeys.all, "public"] as const,
  tools: () => [...agentKeys.all, "tools"] as const,
};

// ─── API Functions ───

async function fetchAgents(): Promise<Agent[]> {
  return apiClient.get("/agents");
}

async function fetchAgent(id: string): Promise<Agent> {
  return apiClient.get(`/agents/${id}`);
}

async function createAgent(data: any): Promise<Agent> {
  return apiClient.post("/agents", data);
}

async function updateAgent(id: string, data: any): Promise<Agent> {
  return apiClient.patch(`/agents/${id}`, data);
}

async function deleteAgent(id: string): Promise<void> {
  return apiClient.delete(`/agents/${id}`);
}

async function updateAgentStatus(id: string, status: string): Promise<Agent> {
  return apiClient.patch(`/agents/${id}/status`, { status });
}

async function publishAgent(id: string): Promise<Agent> {
  return apiClient.post(`/agents/${id}/publish`);
}

async function fetchPublicAgents(): Promise<Agent[]> {
  return apiClient.get("/agents/public");
}

async function fetchAvailableTools(): Promise<any[]> {
  return apiClient.get("/agents/tools/available");
}

async function attachTool(agentId: string, data: any): Promise<AgentTool> {
  return apiClient.post(`/agents/${agentId}/tools`, data);
}

async function removeTool(agentId: string, toolId: string): Promise<void> {
  return apiClient.delete(`/agents/${agentId}/tools/${toolId}`);
}

async function attachIntegration(
  agentId: string,
  data: any,
): Promise<AgentIntegration> {
  return apiClient.post(`/agents/${agentId}/integrations`, data);
}

async function removeIntegration(
  agentId: string,
  integrationId: string,
): Promise<void> {
  return apiClient.delete(`/agents/${agentId}/integrations/${integrationId}`);
}

async function attachKnowledgeBase(
  agentId: string,
  knowledgeBaseId: string,
): Promise<void> {
  return apiClient.post(`/agents/${agentId}/knowledge-bases`, {
    knowledgeBaseId,
  });
}

async function removeKnowledgeBase(
  agentId: string,
  kbId: string,
): Promise<void> {
  return apiClient.delete(`/agents/${agentId}/knowledge-bases/${kbId}`);
}

async function deployChannel(
  agentId: string,
  data: any,
): Promise<AgentChannel> {
  return apiClient.post(`/agents/${agentId}/channels`, data);
}

async function removeChannel(
  agentId: string,
  channelId: string,
): Promise<void> {
  return apiClient.delete(`/agents/${agentId}/channels/${channelId}`);
}

async function fetchRuns(agentId: string): Promise<AgentRun[]> {
  return apiClient.get(`/agents/${agentId}/runs`);
}

async function fetchRun(agentId: string, runId: string): Promise<AgentRun> {
  return apiClient.get(`/agents/${agentId}/runs/${runId}`);
}

async function deleteRun(agentId: string, runId: string): Promise<void> {
  return apiClient.delete(`/agents/${agentId}/runs/${runId}`);
}

// ─── Hooks ───

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: fetchAgents,
    staleTime: 30_000,
  });
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: agentKeys.detail(id!),
    queryFn: () => fetchAgent(id!),
    enabled: !!id,
  });
}

export function usePublicAgents() {
  return useQuery({
    queryKey: agentKeys.public(),
    queryFn: fetchPublicAgents,
    staleTime: 60_000,
  });
}

export function useAvailableTools() {
  return useQuery({
    queryKey: agentKeys.tools(),
    queryFn: fetchAvailableTools,
    staleTime: 300_000,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      updateAgent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.list() });
    },
  });
}

export function useUpdateAgentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateAgentStatus(id, status),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: agentKeys.list() });
    },
  });
}

export function usePublishAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: publishAgent,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: agentKeys.list() });
    },
  });
}

export function useAttachTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: any }) =>
      attachTool(agentId, data),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
    },
  });
}

export function useRemoveTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, toolId }: { agentId: string; toolId: string }) =>
      removeTool(agentId, toolId),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
    },
  });
}

export function useAttachIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: any }) =>
      attachIntegration(agentId, data),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
    },
  });
}

export function useRemoveIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      integrationId,
    }: {
      agentId: string;
      integrationId: string;
    }) => removeIntegration(agentId, integrationId),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
    },
  });
}

export function useAttachKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      knowledgeBaseId,
    }: {
      agentId: string;
      knowledgeBaseId: string;
    }) => attachKnowledgeBase(agentId, knowledgeBaseId),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
    },
  });
}

export function useRemoveKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, kbId }: { agentId: string; kbId: string }) =>
      removeKnowledgeBase(agentId, kbId),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
    },
  });
}

export function useDeployChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: any }) =>
      deployChannel(agentId, data),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
    },
  });
}

export function useRemoveChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      channelId,
    }: {
      agentId: string;
      channelId: string;
    }) => removeChannel(agentId, channelId),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
    },
  });
}

export function useAgentRuns(agentId: string | null) {
  return useQuery({
    queryKey: agentKeys.runs(agentId!),
    queryFn: () => fetchRuns(agentId!),
    enabled: !!agentId,
    staleTime: 15_000,
  });
}

export function useAgentRun(agentId: string | null, runId: string | null) {
  return useQuery({
    queryKey: agentKeys.run(agentId!, runId!),
    queryFn: () => fetchRun(agentId!, runId!),
    enabled: !!agentId && !!runId,
  });
}

export function useDeleteRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, runId }: { agentId: string; runId: string }) =>
      deleteRun(agentId, runId),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentKeys.runs(agentId) });
    },
  });
}

// ─── Subscription ───

async function fetchSubscription(): Promise<{ subscription: any | null }> {
  return apiClient.get("/agents/subscription");
}

export function useAgentSubscription() {
  return useQuery({
    queryKey: [...agentKeys.all, "subscription"] as const,
    queryFn: fetchSubscription,
    staleTime: 60_000,
  });
}

// ─── Clone Template ───

async function cloneTemplate(templateId: string): Promise<Agent> {
  return apiClient.post(`/agents/clone/${templateId}`);
}

export function useCloneTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => cloneTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.list() });
    },
  });
}

// ─── Avatar Upload ───

export function useUploadAgentAvatar() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return apiClient.post<{ icon: string }>(
        "/channels/upload-icon",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
    },
  });
}

// ─── Prompt Generation ───

export function useGeneratePrompt() {
  return useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      return apiClient.post<{ prompt: string }>(
        "/agents/generate-prompt",
        data,
      );
    },
  });
}
