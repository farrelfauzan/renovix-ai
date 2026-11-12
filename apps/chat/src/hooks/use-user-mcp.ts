"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/lib/stores";

export interface UserMcpCredential {
  id: string;
  provider: string;
  status: "connected" | "expired" | "revoked";
  connectedAt: string;
  expiresAt: string | null;
}

/** RNX-293: one account connection and the shared workspaces it is switched on in. */
export interface AccountMcpCredential extends UserMcpCredential {
  workspaceIds: string[];
}

// ─── Query Keys ───

export const userMcpKeys = {
  all: ["user-mcp"] as const,
  credentials: (workspaceId: string | null) =>
    [...userMcpKeys.all, "credentials", workspaceId] as const,
  account: () => [...userMcpKeys.all, "account"] as const,
};

// ─── API Functions ───

async function fetchUserCredentials(
  workspaceId: string,
): Promise<UserMcpCredential[]> {
  return apiClient.get(`/mcp/user/credentials?workspaceId=${workspaceId}`);
}

async function fetchAccountCredentials(): Promise<AccountMcpCredential[]> {
  return apiClient.get("/mcp/user/credentials");
}

async function startUserOAuth(
  provider: string,
  workspaceId?: string,
): Promise<{ authUrl: string }> {
  const workspaceQuery = workspaceId ? `&workspaceId=${workspaceId}` : "";
  return apiClient.get(
    `/mcp/user/oauth/start?provider=${provider}${workspaceQuery}`,
  );
}

async function disconnectUserMcp(
  provider: string,
  workspaceId?: string,
): Promise<void> {
  const workspaceQuery = workspaceId ? `?workspaceId=${workspaceId}` : "";
  return apiClient.delete(`/mcp/user/credentials/${provider}${workspaceQuery}`);
}

async function enableMcpInWorkspace(
  provider: string,
  workspaceId: string,
): Promise<void> {
  return apiClient.put(
    `/mcp/user/credentials/${provider}/workspaces/${workspaceId}`,
  );
}

async function connectWithToken(
  provider: string,
  workspaceId: string | undefined,
  env: Record<string, string>,
): Promise<{ connected: boolean; provider: string }> {
  return apiClient.post("/mcp/user/connect", { provider, workspaceId, env });
}

// ─── Hooks ───

export function useUserMcpCredentials(workspaceId: string | null) {
  const { isLoggedIn } = useAuthStore();
  return useQuery({
    queryKey: userMcpKeys.credentials(workspaceId),
    queryFn: () => fetchUserCredentials(workspaceId!),
    enabled: isLoggedIn() && !!workspaceId,
    staleTime: 30_000,
  });
}

/** RNX-293: every account connection with the workspaces it is switched on in (no workspace needed). */
export function useAccountMcpCredentials() {
  const { isLoggedIn } = useAuthStore();
  return useQuery({
    queryKey: userMcpKeys.account(),
    queryFn: fetchAccountCredentials,
    enabled: isLoggedIn(),
    staleTime: 30_000,
  });
}

type WorkspaceSwitchInput = { provider: string; workspaceId: string };

/**
 * Shared by the switch-on and switch-off mutations: the account list moves at once, goes back to what it was when
 * the call fails, and every user-mcp list is refetched afterwards.
 */
function useWorkspaceSwitch(
  request: (input: WorkspaceSwitchInput) => Promise<void>,
  isOn: boolean,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onMutate: async ({ provider, workspaceId }) => {
      await queryClient.cancelQueries({ queryKey: userMcpKeys.account() });
      const previous = queryClient.getQueryData<AccountMcpCredential[]>(
        userMcpKeys.account(),
      );
      queryClient.setQueryData<AccountMcpCredential[]>(
        userMcpKeys.account(),
        (list) =>
          list?.map((credential) => {
            if (credential.provider !== provider) return credential;
            const others = credential.workspaceIds.filter(
              (id) => id !== workspaceId,
            );
            return {
              ...credential,
              workspaceIds: isOn ? [...others, workspaceId] : others,
            };
          }),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(userMcpKeys.account(), context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userMcpKeys.all });
    },
  });
}

/** RNX-293: PUT the account connection of a provider on in one workspace. */
export function useEnableMcpInWorkspace() {
  return useWorkspaceSwitch(
    ({ provider, workspaceId }) => enableMcpInWorkspace(provider, workspaceId),
    true,
  );
}

/** RNX-293: switch the account connection of a provider off in one workspace; the account keeps it. */
export function useDisableMcpInWorkspace() {
  return useWorkspaceSwitch(
    ({ provider, workspaceId }) => disconnectUserMcp(provider, workspaceId),
    false,
  );
}

export function useStartUserOAuth() {
  return useMutation({
    mutationFn: ({
      provider,
      workspaceId,
    }: {
      provider: string;
      workspaceId?: string;
    }) => startUserOAuth(provider, workspaceId),
  });
}

export function useDisconnectUserMcp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      workspaceId,
    }: {
      provider: string;
      workspaceId?: string;
    }) => disconnectUserMcp(provider, workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userMcpKeys.all });
    },
  });
}

export function useConnectWithToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      workspaceId,
      env,
    }: {
      provider: string;
      workspaceId?: string;
      env: Record<string, string>;
    }) => connectWithToken(provider, workspaceId, env),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userMcpKeys.all });
    },
  });
}
